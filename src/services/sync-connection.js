// src/services/sync-connection.js
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

function handleSyncConnection(ws, fileId, docManager) {
  const { doc, awareness } = docManager.acquire(fileId);

  const syncEncoder = encoding.createEncoder();
  encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(syncEncoder, doc);
  ws.send(encoding.toUint8Array(syncEncoder));

  const updateHandler = (update) => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    ws.send(encoding.toUint8Array(enc));
  };
  doc.on('update', updateHandler);

  const awarenessUpdateHandler = ({ added, updated, removed }) => {
    const changedClients = added.concat(updated).concat(removed);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients));
    ws.send(encoding.toUint8Array(enc));
  };
  awareness.on('update', awarenessUpdateHandler);

  ws.on('message', (data) => {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const messageType = decoding.readVarUint(decoder);
    if (messageType === MESSAGE_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, enc, doc, ws);
      if (encoding.length(enc) > 1) {
        ws.send(encoding.toUint8Array(enc));
      }
    } else if (messageType === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
    }
  });

  ws.on('close', () => {
    doc.off('update', updateHandler);
    awareness.off('update', awarenessUpdateHandler);
    awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], null);
    docManager.release(fileId);
  });
}

module.exports = { handleSyncConnection };
