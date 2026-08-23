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

  // The awareness clientIDs this particular connection speaks for. The
  // awareness map is shared across every connection to this file, so on
  // close we need to know exactly which entries belonged to the socket that
  // just went away. This mirrors how the sync side already attributes
  // origin: inbound awareness frames are applied with `ws` as the origin
  // (see the message handler below), so an 'update' whose origin is this
  // `ws` was caused by this client and names its clientID(s).
  const controlledIds = new Set();

  const awarenessUpdateHandler = ({ added, updated, removed }, origin) => {
    if (origin === ws) {
      added.forEach((clientId) => controlledIds.add(clientId));
      updated.forEach((clientId) => controlledIds.add(clientId));
      removed.forEach((clientId) => controlledIds.delete(clientId));
    }
    const changedClients = added.concat(updated).concat(removed);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients));
    ws.send(encoding.toUint8Array(enc));
  };
  awareness.on('update', awarenessUpdateHandler);

  // Push the awareness states of everyone already in the room to the client
  // that just joined. Awareness updates are only ever broadcast on change,
  // so without this a joiner would see no collaborator cursors or names
  // until some existing peer happened to move - potentially never. Sent
  // after the handler above is registered so a state change landing in
  // between is re-sent rather than lost (a duplicate is harmless; awareness
  // updates are idempotent per clock).
  const existingClients = Array.from(awareness.getStates().keys());
  if (existingClients.length > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, existingClients)
    );
    ws.send(encoding.toUint8Array(awarenessEncoder));
  }

  ws.on('message', (data) => {
    // lib0's binary decoder throws on truncated/garbage payloads. That
    // throw would otherwise escape this EventEmitter listener and crash
    // the whole process (Node has no default handling for a throw inside
    // an 'on' callback other than rethrowing it as uncaught). A malformed
    // frame from one client shouldn't kill the session for everyone else,
    // so log it and drop the message, leaving the connection open.
    try {
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
    } catch (err) {
      console.error('Error handling sync message:', err);
    }
  });

  // ws's internal receiver can emit 'error' on frame/protocol-level issues,
  // distinct from (and firing before) the message handler above. With no
  // listener, Node's EventEmitter rethrows an unhandled 'error' event and
  // crashes the process.
  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  ws.on('close', () => {
    doc.off('update', updateHandler);
    awareness.off('update', awarenessUpdateHandler);
    // Remove the clientIDs this socket actually spoke for - NOT
    // doc.clientID, which is the server-side shared Y.Doc's own internal id
    // and is never a key in the awareness map, making that variant a silent
    // no-op that left ghost cursors behind until Awareness's own ~30s
    // stale-client sweep eventually cleared them.
    if (controlledIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(awareness, Array.from(controlledIds), null);
    }
    docManager.release(fileId);
  });
}

module.exports = { handleSyncConnection };
