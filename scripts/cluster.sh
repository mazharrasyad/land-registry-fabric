#!/usr/bin/env bash
# Jaringan Fabric multi-server. Dijalankan di master (punya akses SSH ke semua node).
# Tidak butuh Docker maupun sudo: peer, orderer, dan chaincode berjalan langsung di tiap server.
#
#   bash scripts/cluster.sh deploy          Bangun jaringan dari nol (identitas, channel, chaincode, data awal)
#   bash scripts/cluster.sh reset           Hapus semua blok, buat ulang channel, isi data awal
#   bash scripts/cluster.sh join node3      Pasang node yang tadinya mati ke jaringan yang sudah berjalan
#   bash scripts/cluster.sh start|stop      Nyalakan/matikan semua node yang terjangkau
#   bash scripts/cluster.sh status          Status proses tiap node
#   bash scripts/cluster.sh autostart       Opsional: pasang crontab @reboot agar node menyala lagi setelah reboot
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NET="$HOME/land-registry-net"
CHANNEL="${CHANNEL_NAME:-mychannel}"
CC_NAME="${CHAINCODE_NAME:-landregistry}"
CC_VERSION=1.0
BIN_SOURCE=node1          # Server yang sudah punya binary Fabric (hasil scripts/setup-fabric.sh).
WEB_NODE=node1
APP_DIR=/var/www/land-registry-fabric

# id:ip:nomor org:peran:orderer (nomor orderer, 0 = bukan orderer)
NODES=(
  "node1:192.168.44.201:1:BPN:1"
  "node2:192.168.44.202:2:PPAT:2"
  "node3:192.168.44.203:3:Validator:0"
  "node4:192.168.44.204:4:Validator:3"
  "node5:192.168.44.205:5:Validator:0"
)
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=5)

log() { echo "[$(date +%H:%M:%S)] $*"; }
field() { cut -d: -f"$2" <<<"$1"; }
terjangkau() { "${SSH[@]}" "$1" true 2>/dev/null; }
cari_node() { for n in "${NODES[@]}"; do [ "$(field "$n" 1)" = "$1" ] && echo "$n"; done; }
remote() { local h=$1; shift; "${SSH[@]}" "$h" "bash ~/land-registry-net/cluster-node.sh $*"; }

siap_binary() {
  mkdir -p "$NET/bin" "$NET/config"
  if [ ! -x "$NET/bin/peer" ]; then
    log "Mengambil binary Fabric dari $BIN_SOURCE"
    rsync -a "$BIN_SOURCE:fabric-samples/bin/" "$NET/bin/"
    rsync -a "$BIN_SOURCE:fabric-samples/config/" "$NET/config/"
    # Builder chaincode-as-a-service milik sendiri, dan tanpa ketergantungan ke Docker.
    python3 - "$NET/config/core.yaml" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
s, n = re.subn(r'externalBuilders:\n(?:\s+- name: ccaas_builder\n\s+path: .*\n\s+propagateEnvironment:\n\s+- .*\n)?',
               f'externalBuilders:\n       - name: ccaas\n         path: BUILDER_PATH\n', s)
assert n == 1
open(p, 'w').write(s)
PY
  fi
  export PATH="$NET/bin:$PATH"
}

tulis_crypto_config() {
  {
    echo "OrdererOrgs:"
    echo "  - Name: Orderer"
    echo "    Domain: example.com"
    echo "    EnableNodeOUs: true"
    echo "    Specs:"
    for n in "${NODES[@]}"; do
      local o; o=$(field "$n" 5)
      [ "$o" = 0 ] && continue
      echo "      - Hostname: orderer$o"
      echo "        SANS: [\"$(field "$n" 2)\", \"$(field "$n" 1)\"]"
    done
    echo "PeerOrgs:"
    for n in "${NODES[@]}"; do
      local i; i=$(field "$n" 3)
      echo "  - Name: Org$i"
      echo "    Domain: org$i.example.com"
      echo "    EnableNodeOUs: true"
      echo "    Specs:"
      echo "      - Hostname: peer0"
      echo "        SANS: [\"$(field "$n" 2)\", \"$(field "$n" 1)\"]"
      echo "    Users: { Count: 1 }"
    done
  } > "$NET/build/crypto-config.yaml"
}

tulis_configtx() {
  local org="$NET/organizations"
  {
    echo "Organizations:"
    echo "  - &OrdererOrg"
    echo "    Name: OrdererMSP"
    echo "    ID: OrdererMSP"
    echo "    MSPDir: $org/ordererOrganizations/example.com/msp"
    echo "    Policies:"
    echo "      Readers: { Type: Signature, Rule: \"OR('OrdererMSP.member')\" }"
    echo "      Writers: { Type: Signature, Rule: \"OR('OrdererMSP.member')\" }"
    echo "      Admins: { Type: Signature, Rule: \"OR('OrdererMSP.admin')\" }"
    echo "    OrdererEndpoints:"
    for n in "${NODES[@]}"; do
      [ "$(field "$n" 5)" = 0 ] || echo "      - $(field "$n" 2):7050"
    done
    for n in "${NODES[@]}"; do
      local i ip; i=$(field "$n" 3); ip=$(field "$n" 2)
      echo "  - &Org$i"
      echo "    Name: Org${i}MSP"
      echo "    ID: Org${i}MSP"
      echo "    MSPDir: $org/peerOrganizations/org$i.example.com/msp"
      echo "    Policies:"
      echo "      Readers: { Type: Signature, Rule: \"OR('Org${i}MSP.admin','Org${i}MSP.peer','Org${i}MSP.client')\" }"
      echo "      Writers: { Type: Signature, Rule: \"OR('Org${i}MSP.admin','Org${i}MSP.client')\" }"
      echo "      Admins: { Type: Signature, Rule: \"OR('Org${i}MSP.admin')\" }"
      echo "      Endorsement: { Type: Signature, Rule: \"OR('Org${i}MSP.peer')\" }"
      echo "    AnchorPeers:"
      echo "      - { Host: $ip, Port: 7051 }"
    done
    cat <<'YAML'
Capabilities:
  Channel: &CapChannel { V2_0: true }
  Orderer: &CapOrderer { V2_0: true }
  Application: &CapApp { V2_5: true }
Profiles:
  LandRegistry:
    Policies:
      Readers: { Type: ImplicitMeta, Rule: "ANY Readers" }
      Writers: { Type: ImplicitMeta, Rule: "ANY Writers" }
      Admins: { Type: ImplicitMeta, Rule: "MAJORITY Admins" }
    Capabilities: *CapChannel
    Orderer:
      OrdererType: etcdraft
      BatchTimeout: 1s
      BatchSize: { MaxMessageCount: 10, AbsoluteMaxBytes: 99 MB, PreferredMaxBytes: 512 KB }
      Policies:
        Readers: { Type: ImplicitMeta, Rule: "ANY Readers" }
        Writers: { Type: ImplicitMeta, Rule: "ANY Writers" }
        Admins: { Type: ImplicitMeta, Rule: "MAJORITY Admins" }
        BlockValidation: { Type: ImplicitMeta, Rule: "ANY Writers" }
      Capabilities: *CapOrderer
      Organizations: [*OrdererOrg]
      EtcdRaft:
        Consenters:
YAML
    for n in "${NODES[@]}"; do
      local o; o=$(field "$n" 5)
      [ "$o" = 0 ] && continue
      local tls="$org/ordererOrganizations/example.com/orderers/orderer$o.example.com/tls/server.crt"
      echo "          - { Host: $(field "$n" 2), Port: 7050, ClientTLSCert: $tls, ServerTLSCert: $tls }"
    done
    cat <<'YAML'
    Application:
      Policies:
        Readers: { Type: ImplicitMeta, Rule: "ANY Readers" }
        Writers: { Type: ImplicitMeta, Rule: "ANY Writers" }
        Admins: { Type: ImplicitMeta, Rule: "MAJORITY Admins" }
        # Suara mayoritas: 3 dari 5 organisasi/node harus menyetujui setiap perubahan data.
        LifecycleEndorsement: { Type: ImplicitMeta, Rule: "MAJORITY Endorsement" }
        Endorsement: { Type: ImplicitMeta, Rule: "MAJORITY Endorsement" }
      Capabilities: *CapApp
      Organizations:
YAML
    for n in "${NODES[@]}"; do echo "        - *Org$(field "$n" 3)"; done
  } > "$NET/build/configtx.yaml"
}

tulis_topologi() {
  {
    echo '{ "nodes": ['
    local pisah=""
    for n in "${NODES[@]}"; do
      local i; i=$(field "$n" 3)
      printf '%s  { "id": "%s", "ip": "%s", "mspId": "Org%sMSP", "domain": "org%s.example.com", "peran": "%s", "endpoint": "%s:7051" }' \
        "$pisah" "$(field "$n" 1)" "$(field "$n" 2)" "$i" "$i" "$(field "$n" 4)" "$(field "$n" 2)"
      pisah=$',\n'
    done
    echo; echo '], "orderers": ['
    pisah=""
    for n in "${NODES[@]}"; do
      local o; o=$(field "$n" 5)
      [ "$o" = 0 ] && continue
      printf '%s  { "id": "orderer%s", "node": "%s", "ip": "%s", "endpoint": "%s:7050" }' \
        "$pisah" "$o" "$(field "$n" 1)" "$(field "$n" 2)" "$(field "$n" 2)"
      pisah=$',\n'
    done
    echo; echo '] }'
  } > "$NET/topology.json"
}

bangun_artefak() {
  log "Membuat identitas organisasi & blok genesis"
  rm -rf "$NET/organizations" "$NET/build"
  mkdir -p "$NET/build"
  tulis_crypto_config
  tulis_topologi
  cryptogen generate --config="$NET/build/crypto-config.yaml" --output="$NET/organizations" >/dev/null
  tulis_configtx
  buat_blok_genesis

  log "Mengompilasi chaincode"
  (cd "$ROOT/chaincode" && npm ci --no-audit --no-fund --silent && npm run --silent build)

  log "Mengemas chaincode (chaincode-as-a-service)"
  local kerja="$NET/build/ccpkg"
  mkdir -p "$kerja"
  echo '{"address":"127.0.0.1:9999","dial_timeout":"10s","tls_required":false}' > "$kerja/connection.json"
  (cd "$kerja" && tar czf code.tar.gz connection.json)
  echo "{\"type\":\"ccaas\",\"label\":\"${CC_NAME}_${CC_VERSION}\"}" > "$kerja/metadata.json"
  (cd "$kerja" && tar czf "$NET/build/$CC_NAME.tgz" metadata.json code.tar.gz)
  echo "${CC_NAME}_${CC_VERSION}:$(sha256sum "$NET/build/$CC_NAME.tgz" | cut -d' ' -f1)" > "$NET/build/ccid"
}

buat_blok_genesis() {
  FABRIC_CFG_PATH="$NET/build" configtxgen -profile LandRegistry -channelID "$CHANNEL" \
    -outputBlock "$NET/build/$CHANNEL.block" 2>/dev/null
}

# Setiap server hanya menerima kunci organisasinya sendiri, ditambah sertifikat CA TLS organisasi lain.
kirim_ke_node() {
  local n=$1 h i o org=organizations
  h=$(field "$n" 1); i=$(field "$n" 3); o=$(field "$n" 5)
  log "Mengirim berkas ke $h"
  "${SSH[@]}" "$h" 'mkdir -p ~/land-registry-net/{bin,config,chaincode,builder/bin,data,logs}'
  rsync -a "$NET/bin/peer" "$NET/bin/orderer" "$NET/bin/osnadmin" "$h:land-registry-net/bin/"
  rsync -aL "$(command -v node)" "$h:land-registry-net/bin/node"
  rsync -a "$NET/config/" "$h:land-registry-net/config/"
  "${SSH[@]}" "$h" "sed -i \"s#BUILDER_PATH#\$HOME/land-registry-net/builder#\" ~/land-registry-net/config/core.yaml"
  rsync -a "$ROOT/scripts/cluster-node.sh" "$h:land-registry-net/"
  rsync -a "$ROOT/scripts/ccaas-builder/" "$h:land-registry-net/builder/bin/"
  rsync -a --delete "$ROOT/chaincode/dist" "$ROOT/chaincode/node_modules" "$ROOT/chaincode/package.json" "$h:land-registry-net/chaincode/"
  rsync -a "$NET/build/$CC_NAME.tgz" "$NET/build/$CHANNEL.block" "$NET/build/ccid" "$h:land-registry-net/"

  "${SSH[@]}" "$h" "rm -rf ~/land-registry-net/$org && mkdir -p ~/land-registry-net/$org/peerOrganizations ~/land-registry-net/$org/ordererOrganizations/example.com/orderers"
  rsync -a "$NET/$org/peerOrganizations/org$i.example.com" "$h:land-registry-net/$org/peerOrganizations/"
  rsync -a "$NET/$org/ordererOrganizations/example.com/tlsca" "$h:land-registry-net/$org/ordererOrganizations/example.com/"
  for lain in "${NODES[@]}"; do
    local j; j=$(field "$lain" 3)
    [ "$j" = "$i" ] && continue
    "${SSH[@]}" "$h" "mkdir -p ~/land-registry-net/$org/peerOrganizations/org$j.example.com"
    rsync -a "$NET/$org/peerOrganizations/org$j.example.com/tlsca" "$h:land-registry-net/$org/peerOrganizations/org$j.example.com/"
  done
  [ "$o" = 0 ] || rsync -a "$NET/$org/ordererOrganizations/example.com/orderers/orderer$o.example.com" \
    "$h:land-registry-net/$org/ordererOrganizations/example.com/orderers/"
  "${SSH[@]}" "$h" "printf 'NODE_ID=%s\nNODE_IP=%s\nORG=%s\nORDERER=%s\nCHANNEL=%s\nCC_NAME=%s\nCC_VERSION=%s\n' $h $(field "$n" 2) $i $o $CHANNEL $CC_NAME $CC_VERSION > ~/land-registry-net/node.env"
}

# Web butuh identitas BPN & PPAT untuk menandatangani transaksi, dan CA TLS semua peer.
kirim_ke_web() {
  local org=organizations
  rsync -a "$NET/topology.json" "$WEB_NODE:land-registry-net/"
  for i in 1 2; do
    rsync -a "$NET/$org/peerOrganizations/org$i.example.com/users/User1@org$i.example.com" \
      "$WEB_NODE:land-registry-net/$org/web-users/"
  done
}

restart_web() {
  log "Memperbarui & merestart web di $WEB_NODE"
  rsync -a --exclude node_modules "$ROOT/application/" "$WEB_NODE:$APP_DIR/application/"
  # Restart=on-failure pada service: proses yang dimatikan paksa akan dinyalakan lagi oleh systemd.
  "${SSH[@]}" "$WEB_NODE" "pkill -KILL -f '^node src/server.js' || true"
}

node_aktif() {
  AKTIF=()
  for n in "${NODES[@]}"; do
    if terjangkau "$(field "$n" 1)"; then AKTIF+=("$n"); else log "$(field "$n" 1) tidak terjangkau, dilewati"; fi
  done
}

mulai_channel() {
  log "Orderer bergabung ke channel (Raft)"
  for n in "${AKTIF[@]}"; do
    [ "$(field "$n" 5)" = 0 ] || remote "$(field "$n" 1)" orderer-join
  done
  log "Peer bergabung ke channel, memasang dan menyetujui chaincode"
  for n in "${AKTIF[@]}"; do remote "$(field "$n" 1)" peer-join; done
  for n in "${AKTIF[@]}"; do remote "$(field "$n" 1)" cc-approve; done
  local alamat=""
  for n in "${AKTIF[@]}"; do alamat+=" $(field "$n" 3):$(field "$n" 2)"; done
  log "Commit chaincode & mengisi data awal"
  remote "$WEB_NODE" cc-commit "'$alamat'"
}

case "${1:-}" in
  deploy)
    siap_binary
    bangun_artefak
    node_aktif
    [ "${#AKTIF[@]}" -ge 3 ] || { echo "Minimal 3 node harus terjangkau (mayoritas dari ${#NODES[@]})." >&2; exit 1; }
    for n in "${AKTIF[@]}"; do kirim_ke_node "$n"; done
    kirim_ke_web
    for n in "${AKTIF[@]}"; do remote "$(field "$n" 1)" wipe; remote "$(field "$n" 1)" start; done
    mulai_channel
    restart_web
    log "Selesai."
    ;;
  reset)
    siap_binary
    node_aktif
    buat_blok_genesis
    for n in "${AKTIF[@]}"; do remote "$(field "$n" 1)" wipe; done
    for n in "${AKTIF[@]}"; do
      rsync -a "$NET/build/$CHANNEL.block" "$(field "$n" 1):land-registry-net/"
      remote "$(field "$n" 1)" start
    done
    mulai_channel
    restart_web
    log "Blockchain kembali ke awal."
    ;;
  join)
    n=$(cari_node "${2:?Sebutkan node, mis. node3}")
    [ -n "$n" ] || { echo "Node $2 tidak dikenal" >&2; exit 1; }
    siap_binary
    kirim_ke_node "$n"
    remote "$(field "$n" 1)" start
    [ "$(field "$n" 5)" = 0 ] || remote "$(field "$n" 1)" orderer-join
    remote "$(field "$n" 1)" peer-join
    remote "$(field "$n" 1)" cc-approve
    log "$(field "$n" 1) sudah bergabung."
    ;;
  autostart)
    for n in "${NODES[@]}"; do
      h=$(field "$n" 1)
      terjangkau "$h" || { echo "== $h: tidak terjangkau"; continue; }
      "${SSH[@]}" "$h" '(crontab -l 2>/dev/null | grep -v land-registry-net; echo "@reboot bash \$HOME/land-registry-net/cluster-node.sh start >> \$HOME/land-registry-net/logs/reboot.log 2>&1") | crontab -'
    done
    ;;
  start|stop|status)
    for n in "${NODES[@]}"; do
      h=$(field "$n" 1)
      if terjangkau "$h"; then echo "== $h"; remote "$h" "$1"; else echo "== $h: tidak terjangkau"; fi
    done
    ;;
  *)
    sed -n '2,11p' "${BASH_SOURCE[0]}"
    exit 1
    ;;
esac
