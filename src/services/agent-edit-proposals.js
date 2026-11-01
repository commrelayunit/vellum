const Y = require('yjs');

function encodedPosition(position) { return Buffer.from(Y.encodeRelativePosition(position)); }
function decodedPosition(value) { return Y.decodeRelativePosition(Uint8Array.from(Buffer.from(value, 'base64'))); }

function countOccurrences(text, needle) {
  if (!needle) return text.length === 0 ? 1 : 0;
  let count = 0; let i = text.indexOf(needle);
  while (i !== -1) { count += 1; i = text.indexOf(needle, i + needle.length); }
  return count;
}

// 1-based line numbers for the proposal's current location, computed at
// proposal-creation time from the plain-text offsets - purely a display aid
// for the Review tab's "location" column, not used for anchoring/resolution
// (that's done via the Yjs relative positions above/below, which stay
// correct across concurrent edits in a way a static line number cannot).
function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (content[i] === '\n') line += 1;
  return line;
}

function createProposalService({ docManager, proposalsRepo }) {
  return {
    propose({ fileId, providerLabel, providerColor, oldText, newText }) {
      if (typeof oldText !== 'string' || typeof newText !== 'string') return { success: false, message: 'old_string and new_string must both be strings' };
      const { doc } = docManager.acquire(fileId);
      try {
        const ytext = doc.getText('content'); const content = ytext.toString();
        const count = countOccurrences(content, oldText);
        if (count !== 1) return { success: false, message: count ? 'old_string is ambiguous; quote more context' : 'old_string not found in the document' };
        const start = content.indexOf(oldText);
        const proposal = proposalsRepo.create({ fileId, providerLabel, providerColor, oldText, newText,
          anchor: encodedPosition(Y.createRelativePositionFromTypeIndex(ytext, start)),
          head: encodedPosition(Y.createRelativePositionFromTypeIndex(ytext, start + oldText.length, -1)),
          startLine: lineOf(content, start),
          endLine: lineOf(content, start + oldText.length) });
        return { success: true, message: 'Edit proposed for review.', proposal };
      } finally { docManager.release(fileId); }
    },
    accept({ id, fileId }) {
      const proposal = proposalsRepo.getById(id);
      if (!proposal || proposal.file_id !== fileId) return { success: false, status: 404, message: 'Proposal not found' };
      if (proposal.state !== 'pending') return { success: false, status: 409, message: `Proposal is already ${proposal.state}`, proposal };
      const { doc } = docManager.acquire(fileId);
      try {
        const ytext = doc.getText('content');
        const start = Y.createAbsolutePositionFromRelativePosition(decodedPosition(proposal.anchor), doc);
        const end = Y.createAbsolutePositionFromRelativePosition(decodedPosition(proposal.head), doc);
        if (!start || !end || start.type !== ytext || end.type !== ytext) {
          const stale = proposalsRepo.resolvePending(id, 'stale', 'The anchored source range no longer exists.') || proposalsRepo.getById(id);
          return { success: false, status: 409, message: stale.outcome_message, proposal: stale };
        }
        const from = Math.min(start.index, end.index); const to = Math.max(start.index, end.index);
        if (ytext.toString().slice(from, to) !== proposal.old_text) {
          const conflict = proposalsRepo.resolvePending(id, 'conflict', 'The source text changed after this proposal was created.') || proposalsRepo.getById(id);
          return { success: false, status: 409, message: conflict.outcome_message, proposal: conflict };
        }
        // The conditional transition is the claim. SQLite performs it atomically,
        // so a second click/request cannot apply the same proposal twice.
        const accepted = proposalsRepo.resolvePending(id, 'accepted', 'Applied to the current document.');
        if (!accepted) {
          const current = proposalsRepo.getById(id);
          return { success: false, status: 409, message: `Proposal is already ${current.state}`, proposal: current };
        }
        doc.transact(() => { ytext.delete(from, to - from); ytext.insert(from, proposal.new_text); });
        return { success: true, proposal: accepted };
      } finally { docManager.release(fileId); }
    },
    reject({ id, fileId }) {
      const proposal = proposalsRepo.getById(id);
      if (!proposal || proposal.file_id !== fileId) return { success: false, status: 404, message: 'Proposal not found' };
      if (proposal.state !== 'pending') return { success: false, status: 409, message: `Proposal is already ${proposal.state}`, proposal };
      const rejected = proposalsRepo.resolvePending(id, 'rejected', 'Rejected; document unchanged.');
      if (!rejected) {
        const current = proposalsRepo.getById(id);
        return { success: false, status: 409, message: `Proposal is already ${current.state}`, proposal: current };
      }
      return { success: true, proposal: rejected };
    }
  };
}
module.exports = { createProposalService };
