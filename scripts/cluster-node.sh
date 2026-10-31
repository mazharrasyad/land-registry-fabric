#!/usr/bin/env bash
# Dijalankan di tiap server oleh scripts/cluster.sh: mengatur proses peer, orderer, dan chaincode.
set -euo pipefail

NET="$HOME/land-registry-net"
# shellcheck disable=SC1091
source "$NET/node.env"
export PATH="$NET/bin:$PATH"
export FABRIC_CFG_PATH="$NET/config"

DOMAIN="org$ORG.example.com"
ORGS="$NET/organizations"
PEER_DIR="$ORGS/peerOrganizations/$DOMAIN"
ORDERER_CA="$ORGS/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"
# Orderer mana pun bisa menerima transaksi; orderer1 di node1 dipakai untuk perintah admin.
ORDERER_ADDR=192.168.44.201:7050

jalan() { pgrep -u "$(id -u)" -f "$1" >/dev/null; }

latar() {
  local nama=$1; shift
  setsid nohup "$@" >> "$NET/logs/$nama.log" 2>&1 < /dev/null &
}

mulai_orderer() {
  local d="$ORGS/ordererOrganizations/example.com/orderers/orderer$ORDERER.example.com"
  ORDERER_GENERAL_LISTENADDRESS=$NODE_IP \
  ORDERER_GENERAL_LISTENPORT=7050 \
  ORDERER_GENERAL_LOCALMSPID=OrdererMSP \
  ORDERER_GENERAL_LOCALMSPDIR=$d/msp \
  ORDERER_GENERAL_TLS_ENABLED=true \
  ORDERER_GENERAL_TLS_PRIVATEKEY=$d/tls/server.key \
  ORDERER_GENERAL_TLS_CERTIFICATE=$d/tls/server.crt \
  ORDERER_GENERAL_TLS_ROOTCAS=[$d/tls/ca.crt] \
  ORDERER_GENERAL_CLUSTER_CLIENTCERTIFICATE=$d/tls/server.crt \
  ORDERER_GENERAL_CLUSTER_CLIENTPRIVATEKEY=$d/tls/server.key \
  ORDERER_GENERAL_CLUSTER_ROOTCAS=[$d/tls/ca.crt] \
  ORDERER_GENERAL_BOOTSTRAPMETHOD=none \
  ORDERER_CHANNELPARTICIPATION_ENABLED=true \
  ORDERER_ADMIN_LISTENADDRESS=$NODE_IP:7053 \
  ORDERER_ADMIN_TLS_ENABLED=true \
  ORDERER_ADMIN_TLS_PRIVATEKEY=$d/tls/server.key \
  ORDERER_ADMIN_TLS_CERTIFICATE=$d/tls/server.crt \
  ORDERER_ADMIN_TLS_CLIENTAUTHREQUIRED=true \
  ORDERER_ADMIN_TLS_CLIENTROOTCAS=[$d/tls/ca.crt] \
  ORDERER_OPERATIONS_LISTENADDRESS=$NODE_IP:9443 \
  ORDERER_FILELEDGER_LOCATION=$NET/data/orderer \
  ORDERER_CONSENSUS_WALDIR=$NET/data/orderer/etcdraft/wal \
  ORDERER_CONSENSUS_SNAPDIR=$NET/data/orderer/etcdraft/snapshot \
  latar orderer "$NET/bin/orderer"
}

mulai_peer() {
  CORE_PEER_ID=peer0.$DOMAIN \
  CORE_PEER_ADDRESS=$NODE_IP:7051 \
  CORE_PEER_LISTENADDRESS=$NODE_IP:7051 \
  CORE_PEER_CHAINCODEADDRESS=127.0.0.1:7052 \
  CORE_PEER_CHAINCODELISTENADDRESS=127.0.0.1:7052 \
  CORE_PEER_GOSSIP_BOOTSTRAP=$NODE_IP:7051 \
  CORE_PEER_GOSSIP_EXTERNALENDPOINT=$NODE_IP:7051 \
  CORE_PEER_LOCALMSPID=Org${ORG}MSP \
  CORE_PEER_MSPCONFIGPATH=$PEER_DIR/peers/peer0.$DOMAIN/msp \
  CORE_PEER_TLS_ENABLED=true \
  CORE_PEER_TLS_CERT_FILE=$PEER_DIR/peers/peer0.$DOMAIN/tls/server.crt \
  CORE_PEER_TLS_KEY_FILE=$PEER_DIR/peers/peer0.$DOMAIN/tls/server.key \
  CORE_PEER_TLS_ROOTCERT_FILE=$PEER_DIR/peers/peer0.$DOMAIN/tls/ca.crt \
  CORE_PEER_FILESYSTEMPATH=$NET/data/peer \
  CORE_LEDGER_SNAPSHOTS_ROOTDIR=$NET/data/peer/snapshots \
  CORE_OPERATIONS_LISTENADDRESS=$NODE_IP:9444 \
  CORE_VM_ENDPOINT= \
  latar peer "$NET/bin/peer" node start
}

mulai_chaincode() {
  (
    cd "$NET/chaincode"
    latar chaincode "$NET/bin/node" node_modules/fabric-shim/cli.js server \
      --chaincode-address=127.0.0.1:9999 --chaincode-id="$(cat "$NET/ccid")"
  )
}

# Identitas admin organisasi ini untuk perintah peer.
admin_env() {
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID=Org${ORG}MSP
  export CORE_PEER_ADDRESS=$NODE_IP:7051
  export CORE_PEER_TLS_ROOTCERT_FILE=$PEER_DIR/tlsca/tlsca.$DOMAIN-cert.pem
  export CORE_PEER_MSPCONFIGPATH=$PEER_DIR/users/Admin@$DOMAIN/msp
}

coba_ulang() {
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    "$@" 2>/tmp/lr-net.$$ && { rm -f /tmp/lr-net.$$; return 0; }
    sleep 3
  done
  cat /tmp/lr-net.$$ >&2; rm -f /tmp/lr-net.$$
  return 1
}

case "$1" in
  start)
    mkdir -p "$NET/logs" "$NET/data"
    [ "$ORDERER" = 0 ] || jalan "$NET/bin/orderer" || mulai_orderer
    jalan "$NET/bin/peer node start" || mulai_peer
    jalan "fabric-shim/cli.js server" || mulai_chaincode
    ;;
  stop)
    pkill -u "$(id -u)" -f "fabric-shim/cli.js server" || true
    pkill -u "$(id -u)" -f "$NET/bin/peer node start" || true
    pkill -u "$(id -u)" -f "$NET/bin/orderer" || true
    ;;
  wipe)
    "$0" stop
    sleep 1
    rm -rf "$NET/data" "$NET/logs"
    mkdir -p "$NET/data" "$NET/logs"
    ;;
  status)
    for p in "$NET/bin/orderer" "$NET/bin/peer node start" "fabric-shim/cli.js server"; do
      jalan "$p" && echo "  jalan: $p" || echo "  mati : $p"
    done
    ;;
  orderer-join)
    d="$ORGS/ordererOrganizations/example.com/orderers/orderer$ORDERER.example.com"
    coba_ulang osnadmin channel join --channelID "$CHANNEL" --config-block "$NET/$CHANNEL.block" \
      -o "$NODE_IP:7053" --ca-file "$ORDERER_CA" --client-cert "$d/tls/server.crt" --client-key "$d/tls/server.key" >/dev/null
    ;;
  peer-join)
    admin_env
    coba_ulang peer channel join -b "$NET/$CHANNEL.block"
    coba_ulang peer lifecycle chaincode install "$NET/$CC_NAME.tgz"
    ;;
  cc-approve)
    admin_env
    coba_ulang peer lifecycle chaincode approveformyorg -o "$ORDERER_ADDR" --tls --cafile "$ORDERER_CA" \
      --channelID "$CHANNEL" --name "$CC_NAME" --version "$CC_VERSION" --sequence 1 --package-id "$(cat "$NET/ccid")"
    ;;
  cc-commit)
    # Argumen: daftar "<nomor org>:<ip>" dari node yang aktif.
    admin_env
    alamat=()
    for a in $2; do
      alamat+=(--peerAddresses "${a#*:}:7051" --tlsRootCertFiles "$ORGS/peerOrganizations/org${a%%:*}.example.com/tlsca/tlsca.org${a%%:*}.example.com-cert.pem")
    done
    coba_ulang peer lifecycle chaincode commit -o "$ORDERER_ADDR" --tls --cafile "$ORDERER_CA" \
      --channelID "$CHANNEL" --name "$CC_NAME" --version "$CC_VERSION" --sequence 1 "${alamat[@]}"
    coba_ulang peer chaincode invoke -o "$ORDERER_ADDR" --tls --cafile "$ORDERER_CA" -C "$CHANNEL" -n "$CC_NAME" \
      "${alamat[@]}" --waitForEvent -c '{"function":"InitLedger","Args":[]}'
    ;;
  *)
    echo "Perintah tidak dikenal: $1" >&2
    exit 1
    ;;
esac
