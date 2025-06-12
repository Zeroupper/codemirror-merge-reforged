'use strict';

var view = require('@codemirror/view');
var state = require('@codemirror/state');
var language = require('@codemirror/language');
var commands = require('@codemirror/commands');

// This algorithm was heavily inspired by Neil Fraser's
// diff-match-patch library. See https://github.com/google/diff-match-patch/
/// A changed range.
class Change {
    constructor(
    /// The start of the change in document A.
    fromA, 
    /// The end of the change in document A. This is equal to `fromA`
    /// in case of insertions.
    toA, 
    /// The start of the change in document B.
    fromB, 
    /// The end of the change in document B. This is equal to `fromB`
    /// for deletions.
    toB) {
        this.fromA = fromA;
        this.toA = toA;
        this.fromB = fromB;
        this.toB = toB;
    }
    /// @internal
    offset(offA, offB = offA) {
        return new Change(this.fromA + offA, this.toA + offA, this.fromB + offB, this.toB + offB);
    }
}
function findDiff(a, fromA, toA, b, fromB, toB) {
    if (a == b)
        return [];
    // Remove identical prefix and suffix
    let prefix = commonPrefix(a, fromA, toA, b, fromB, toB);
    let suffix = commonSuffix(a, fromA + prefix, toA, b, fromB + prefix, toB);
    fromA += prefix;
    toA -= suffix;
    fromB += prefix;
    toB -= suffix;
    let lenA = toA - fromA, lenB = toB - fromB;
    // Nothing left in one of them
    if (!lenA || !lenB)
        return [new Change(fromA, toA, fromB, toB)];
    // Try to find one string in the other to cover cases with just 2
    // deletions/insertions.
    if (lenA > lenB) {
        let found = a.slice(fromA, toA).indexOf(b.slice(fromB, toB));
        if (found > -1)
            return [
                new Change(fromA, fromA + found, fromB, fromB),
                new Change(fromA + found + lenB, toA, toB, toB)
            ];
    }
    else if (lenB > lenA) {
        let found = b.slice(fromB, toB).indexOf(a.slice(fromA, toA));
        if (found > -1)
            return [
                new Change(fromA, fromA, fromB, fromB + found),
                new Change(toA, toA, fromB + found + lenA, toB)
            ];
    }
    // Only one character left on one side, does not occur in other
    // string.
    if (lenA == 1 || lenB == 1)
        return [new Change(fromA, toA, fromB, toB)];
    // Try to split the problem in two by finding a substring of one of
    // the strings in the other.
    let half = halfMatch(a, fromA, toA, b, fromB, toB);
    if (half) {
        let [sharedA, sharedB, sharedLen] = half;
        return findDiff(a, fromA, sharedA, b, fromB, sharedB)
            .concat(findDiff(a, sharedA + sharedLen, toA, b, sharedB + sharedLen, toB));
    }
    // Fall back to more expensive general search for a shared
    // subsequence.
    return findSnake(a, fromA, toA, b, fromB, toB);
}
let scanLimit = 1e9;
let timeout = 0;
let crude = false;
// Implementation of Myers 1986 "An O(ND) Difference Algorithm and Its Variations"
function findSnake(a, fromA, toA, b, fromB, toB) {
    let lenA = toA - fromA, lenB = toB - fromB;
    if (scanLimit < 1e9 && Math.min(lenA, lenB) > scanLimit * 16 ||
        timeout > 0 && Date.now() > timeout) {
        if (Math.min(lenA, lenB) > scanLimit * 64)
            return [new Change(fromA, toA, fromB, toB)];
        return crudeMatch(a, fromA, toA, b, fromB, toB);
    }
    let off = Math.ceil((lenA + lenB) / 2);
    frontier1.reset(off);
    frontier2.reset(off);
    let match1 = (x, y) => a.charCodeAt(fromA + x) == b.charCodeAt(fromB + y);
    let match2 = (x, y) => a.charCodeAt(toA - x - 1) == b.charCodeAt(toB - y - 1);
    let test1 = (lenA - lenB) % 2 != 0 ? frontier2 : null, test2 = test1 ? null : frontier1;
    for (let depth = 0; depth < off; depth++) {
        if (depth > scanLimit || timeout > 0 && !(depth & 63) && Date.now() > timeout)
            return crudeMatch(a, fromA, toA, b, fromB, toB);
        let done = frontier1.advance(depth, lenA, lenB, off, test1, false, match1) ||
            frontier2.advance(depth, lenA, lenB, off, test2, true, match2);
        if (done)
            return bisect(a, fromA, toA, fromA + done[0], b, fromB, toB, fromB + done[1]);
    }
    // No commonality at all.
    return [new Change(fromA, toA, fromB, toB)];
}
class Frontier {
    constructor() {
        this.vec = [];
    }
    reset(off) {
        this.len = off << 1;
        for (let i = 0; i < this.len; i++)
            this.vec[i] = -1;
        this.vec[off + 1] = 0;
        this.start = this.end = 0;
    }
    advance(depth, lenX, lenY, vOff, other, fromBack, match) {
        for (let k = -depth + this.start; k <= depth - this.end; k += 2) {
            let off = vOff + k;
            let x = k == -depth || (k != depth && this.vec[off - 1] < this.vec[off + 1])
                ? this.vec[off + 1] : this.vec[off - 1] + 1;
            let y = x - k;
            while (x < lenX && y < lenY && match(x, y)) {
                x++;
                y++;
            }
            this.vec[off] = x;
            if (x > lenX) {
                this.end += 2;
            }
            else if (y > lenY) {
                this.start += 2;
            }
            else if (other) {
                let offOther = vOff + (lenX - lenY) - k;
                if (offOther >= 0 && offOther < this.len && other.vec[offOther] != -1) {
                    if (!fromBack) {
                        let xOther = lenX - other.vec[offOther];
                        if (x >= xOther)
                            return [x, y];
                    }
                    else {
                        let xOther = other.vec[offOther];
                        if (xOther >= lenX - x)
                            return [xOther, vOff + xOther - offOther];
                    }
                }
            }
        }
        return null;
    }
}
// Reused across calls to avoid growing the vectors again and again
const frontier1 = new Frontier, frontier2 = new Frontier;
// Given a position in both strings, recursively call `findDiff` with
// the sub-problems before and after that position. Make sure cut
// points lie on character boundaries.
function bisect(a, fromA, toA, splitA, b, fromB, toB, splitB) {
    let stop = false;
    if (!validIndex(a, splitA) && ++splitA == toA)
        stop = true;
    if (!validIndex(b, splitB) && ++splitB == toB)
        stop = true;
    if (stop)
        return [new Change(fromA, toA, fromB, toB)];
    return findDiff(a, fromA, splitA, b, fromB, splitB).concat(findDiff(a, splitA, toA, b, splitB, toB));
}
function chunkSize(lenA, lenB) {
    let size = 1, max = Math.min(lenA, lenB);
    while (size < max)
        size = size << 1;
    return size;
}
// Common prefix length of the given ranges. Because string comparison
// is so much faster than a JavaScript by-character loop, this
// compares whole chunks at a time.
function commonPrefix(a, fromA, toA, b, fromB, toB) {
    if (fromA == toA || fromA == toB || a.charCodeAt(fromA) != b.charCodeAt(fromB))
        return 0;
    let chunk = chunkSize(toA - fromA, toB - fromB);
    for (let pA = fromA, pB = fromB;;) {
        let endA = pA + chunk, endB = pB + chunk;
        if (endA > toA || endB > toB || a.slice(pA, endA) != b.slice(pB, endB)) {
            if (chunk == 1)
                return pA - fromA - (validIndex(a, pA) ? 0 : 1);
            chunk = chunk >> 1;
        }
        else if (endA == toA || endB == toB) {
            return endA - fromA;
        }
        else {
            pA = endA;
            pB = endB;
        }
    }
}
// Common suffix length
function commonSuffix(a, fromA, toA, b, fromB, toB) {
    if (fromA == toA || fromB == toB || a.charCodeAt(toA - 1) != b.charCodeAt(toB - 1))
        return 0;
    let chunk = chunkSize(toA - fromA, toB - fromB);
    for (let pA = toA, pB = toB;;) {
        let sA = pA - chunk, sB = pB - chunk;
        if (sA < fromA || sB < fromB || a.slice(sA, pA) != b.slice(sB, pB)) {
            if (chunk == 1)
                return toA - pA - (validIndex(a, pA) ? 0 : 1);
            chunk = chunk >> 1;
        }
        else if (sA == fromA || sB == fromB) {
            return toA - sA;
        }
        else {
            pA = sA;
            pB = sB;
        }
    }
}
// a assumed to be be longer than b
function findMatch(a, fromA, toA, b, fromB, toB, size, divideTo) {
    let rangeB = b.slice(fromB, toB);
    // Try some substrings of A of length `size` and see if they exist
    // in B.
    let best = null;
    for (;;) {
        if (best || size < divideTo)
            return best;
        for (let start = fromA + size;;) {
            if (!validIndex(a, start))
                start++;
            let end = start + size;
            if (!validIndex(a, end))
                end += end == start + 1 ? 1 : -1;
            if (end >= toA)
                break;
            let seed = a.slice(start, end);
            let found = -1;
            while ((found = rangeB.indexOf(seed, found + 1)) != -1) {
                let prefixAfter = commonPrefix(a, end, toA, b, fromB + found + seed.length, toB);
                let suffixBefore = commonSuffix(a, fromA, start, b, fromB, fromB + found);
                let length = seed.length + prefixAfter + suffixBefore;
                if (!best || best[2] < length)
                    best = [start - suffixBefore, fromB + found - suffixBefore, length];
            }
            start = end;
        }
        if (divideTo < 0)
            return best;
        size = size >> 1;
    }
}
// Find a shared substring that is at least half the length of the
// longer range. Returns an array describing the substring [startA,
// startB, len], or null.
function halfMatch(a, fromA, toA, b, fromB, toB) {
    let lenA = toA - fromA, lenB = toB - fromB;
    if (lenA < lenB) {
        let result = halfMatch(b, fromB, toB, a, fromA, toA);
        return result && [result[1], result[0], result[2]];
    }
    // From here a is known to be at least as long as b
    if (lenA < 4 || lenB * 2 < lenA)
        return null;
    return findMatch(a, fromA, toA, b, fromB, toB, Math.floor(lenA / 4), -1);
}
function crudeMatch(a, fromA, toA, b, fromB, toB) {
    crude = true;
    let lenA = toA - fromA, lenB = toB - fromB;
    let result;
    if (lenA < lenB) {
        let inv = findMatch(b, fromB, toB, a, fromA, toA, Math.floor(lenA / 6), 50);
        result = inv && [inv[1], inv[0], inv[2]];
    }
    else {
        result = findMatch(a, fromA, toA, b, fromB, toB, Math.floor(lenB / 6), 50);
    }
    if (!result)
        return [new Change(fromA, toA, fromB, toB)];
    let [sharedA, sharedB, sharedLen] = result;
    return findDiff(a, fromA, sharedA, b, fromB, sharedB)
        .concat(findDiff(a, sharedA + sharedLen, toA, b, sharedB + sharedLen, toB));
}
function mergeAdjacent(changes, minGap) {
    for (let i = 1; i < changes.length; i++) {
        let prev = changes[i - 1], cur = changes[i];
        if (prev.toA > cur.fromA - minGap && prev.toB > cur.fromB - minGap) {
            changes[i - 1] = new Change(prev.fromA, cur.toA, prev.fromB, cur.toB);
            changes.splice(i--, 1);
        }
    }
}
// Reorder and merge changes
function normalize(a, b, changes) {
    for (;;) {
        mergeAdjacent(changes, 1);
        let moved = false;
        // Move unchanged ranges that can be fully moved across an
        // adjacent insertion/deletion, to simplify the diff.
        for (let i = 0; i < changes.length; i++) {
            let ch = changes[i], pre, post;
            // The half-match heuristic sometimes produces non-minimal
            // diffs. Strip matching pre- and post-fixes again here.
            if (pre = commonPrefix(a, ch.fromA, ch.toA, b, ch.fromB, ch.toB))
                ch = changes[i] = new Change(ch.fromA + pre, ch.toA, ch.fromB + pre, ch.toB);
            if (post = commonSuffix(a, ch.fromA, ch.toA, b, ch.fromB, ch.toB))
                ch = changes[i] = new Change(ch.fromA, ch.toA - post, ch.fromB, ch.toB - post);
            let lenA = ch.toA - ch.fromA, lenB = ch.toB - ch.fromB;
            // Only look at plain insertions/deletions
            if (lenA && lenB)
                continue;
            let beforeLen = ch.fromA - (i ? changes[i - 1].toA : 0);
            let afterLen = (i < changes.length - 1 ? changes[i + 1].fromA : a.length) - ch.toA;
            if (!beforeLen || !afterLen)
                continue;
            let text = lenA ? a.slice(ch.fromA, ch.toA) : b.slice(ch.fromB, ch.toB);
            if (beforeLen <= text.length &&
                a.slice(ch.fromA - beforeLen, ch.fromA) == text.slice(text.length - beforeLen)) {
                // Text before matches the end of the change
                changes[i] = new Change(ch.fromA - beforeLen, ch.toA - beforeLen, ch.fromB - beforeLen, ch.toB - beforeLen);
                moved = true;
            }
            else if (afterLen <= text.length &&
                a.slice(ch.toA, ch.toA + afterLen) == text.slice(0, afterLen)) {
                // Text after matches the start of the change
                changes[i] = new Change(ch.fromA + afterLen, ch.toA + afterLen, ch.fromB + afterLen, ch.toB + afterLen);
                moved = true;
            }
        }
        if (!moved)
            break;
    }
    return changes;
}
// Process a change set to make it suitable for presenting to users.
function makePresentable(changes, a, b) {
    for (let posA = 0, i = 0; i < changes.length; i++) {
        let change = changes[i];
        let lenA = change.toA - change.fromA, lenB = change.toB - change.fromB;
        // Don't touch short insertions or deletions.
        if (lenA && lenB || lenA > 3 || lenB > 3) {
            let nextChangeA = i == changes.length - 1 ? a.length : changes[i + 1].fromA;
            let maxScanBefore = change.fromA - posA, maxScanAfter = nextChangeA - change.toA;
            let boundBefore = findWordBoundaryBefore(a, change.fromA, maxScanBefore);
            let boundAfter = findWordBoundaryAfter(a, change.toA, maxScanAfter);
            let lenBefore = change.fromA - boundBefore, lenAfter = boundAfter - change.toA;
            // An insertion or deletion that falls inside words on both
            // sides can maybe be moved to align with word boundaries.
            if ((!lenA || !lenB) && lenBefore && lenAfter) {
                let changeLen = Math.max(lenA, lenB);
                let [changeText, changeFrom, changeTo] = lenA ? [a, change.fromA, change.toA] : [b, change.fromB, change.toB];
                if (changeLen > lenBefore &&
                    a.slice(boundBefore, change.fromA) == changeText.slice(changeTo - lenBefore, changeTo)) {
                    change = changes[i] = new Change(boundBefore, boundBefore + lenA, change.fromB - lenBefore, change.toB - lenBefore);
                    boundBefore = change.fromA;
                    boundAfter = findWordBoundaryAfter(a, change.toA, nextChangeA - change.toA);
                }
                else if (changeLen > lenAfter &&
                    a.slice(change.toA, boundAfter) == changeText.slice(changeFrom, changeFrom + lenAfter)) {
                    change = changes[i] = new Change(boundAfter - lenA, boundAfter, change.fromB + lenAfter, change.toB + lenAfter);
                    boundAfter = change.toA;
                    boundBefore = findWordBoundaryBefore(a, change.fromA, change.fromA - posA);
                }
                lenBefore = change.fromA - boundBefore;
                lenAfter = boundAfter - change.toA;
            }
            if (lenBefore || lenAfter) {
                // Expand the change to cover the entire word
                change = changes[i] = new Change(change.fromA - lenBefore, change.toA + lenAfter, change.fromB - lenBefore, change.toB + lenAfter);
            }
            else if (!lenA) {
                // Align insertion to line boundary, when possible
                let first = findLineBreakAfter(b, change.fromB, change.toB), len;
                let last = first < 0 ? -1 : findLineBreakBefore(b, change.toB, change.fromB);
                if (first > -1 && (len = first - change.fromB) <= maxScanAfter &&
                    b.slice(change.fromB, first) == b.slice(change.toB, change.toB + len))
                    change = changes[i] = change.offset(len);
                else if (last > -1 && (len = change.toB - last) <= maxScanBefore &&
                    b.slice(change.fromB - len, change.fromB) == b.slice(last, change.toB))
                    change = changes[i] = change.offset(-len);
            }
            else if (!lenB) {
                // Align deletion to line boundary
                let first = findLineBreakAfter(a, change.fromA, change.toA), len;
                let last = first < 0 ? -1 : findLineBreakBefore(a, change.toA, change.fromA);
                if (first > -1 && (len = first - change.fromA) <= maxScanAfter &&
                    a.slice(change.fromA, first) == a.slice(change.toA, change.toA + len))
                    change = changes[i] = change.offset(len);
                else if (last > -1 && (len = change.toA - last) <= maxScanBefore &&
                    a.slice(change.fromA - len, change.fromA) == a.slice(last, change.toA))
                    change = changes[i] = change.offset(-len);
            }
        }
        posA = change.toA;
    }
    mergeAdjacent(changes, 3);
    return changes;
}
let wordChar;
try {
    wordChar = new RegExp("[\\p{Alphabetic}\\p{Number}]", "u");
}
catch (_) { }
function asciiWordChar(code) {
    return code > 48 && code < 58 || code > 64 && code < 91 || code > 96 && code < 123;
}
function wordCharAfter(s, pos) {
    if (pos == s.length)
        return 0;
    let next = s.charCodeAt(pos);
    if (next < 192)
        return asciiWordChar(next) ? 1 : 0;
    if (!wordChar)
        return 0;
    if (!isSurrogate1(next) || pos == s.length - 1)
        return wordChar.test(String.fromCharCode(next)) ? 1 : 0;
    return wordChar.test(s.slice(pos, pos + 2)) ? 2 : 0;
}
function wordCharBefore(s, pos) {
    if (!pos)
        return 0;
    let prev = s.charCodeAt(pos - 1);
    if (prev < 192)
        return asciiWordChar(prev) ? 1 : 0;
    if (!wordChar)
        return 0;
    if (!isSurrogate2(prev) || pos == 1)
        return wordChar.test(String.fromCharCode(prev)) ? 1 : 0;
    return wordChar.test(s.slice(pos - 2, pos)) ? 2 : 0;
}
const MAX_SCAN = 8;
function findWordBoundaryAfter(s, pos, max) {
    if (pos == s.length || !wordCharBefore(s, pos))
        return pos;
    for (let cur = pos, end = pos + max, i = 0; i < MAX_SCAN; i++) {
        let size = wordCharAfter(s, cur);
        if (!size || cur + size > end)
            return cur;
        cur += size;
    }
    return pos;
}
function findWordBoundaryBefore(s, pos, max) {
    if (!pos || !wordCharAfter(s, pos))
        return pos;
    for (let cur = pos, end = pos - max, i = 0; i < MAX_SCAN; i++) {
        let size = wordCharBefore(s, cur);
        if (!size || cur - size < end)
            return cur;
        cur -= size;
    }
    return pos;
}
function findLineBreakBefore(s, pos, stop) {
    for (; pos != stop; pos--)
        if (s.charCodeAt(pos - 1) == 10)
            return pos;
    return -1;
}
function findLineBreakAfter(s, pos, stop) {
    for (; pos != stop; pos++)
        if (s.charCodeAt(pos) == 10)
            return pos;
    return -1;
}
const isSurrogate1 = (code) => code >= 0xD800 && code <= 0xDBFF;
const isSurrogate2 = (code) => code >= 0xDC00 && code <= 0xDFFF;
// Returns false if index looks like it is in the middle of a
// surrogate pair.
function validIndex(s, index) {
    return !index || index == s.length || !isSurrogate1(s.charCodeAt(index - 1)) || !isSurrogate2(s.charCodeAt(index));
}
/// Compute the difference between two strings.
function diff(a, b, config) {
    scanLimit = (config?.scanLimit ?? 1e9) >> 1;
    timeout = config?.timeout ? Date.now() + config.timeout : 0;
    crude = false;
    return normalize(a, b, findDiff(a, 0, a.length, b, 0, b.length));
}
// Return whether the last diff fell back to the imprecise algorithm.
function diffIsPrecise() { return !crude; }
/// Compute the difference between the given strings, and clean up the
/// resulting diff for presentation to users by dropping short
/// unchanged ranges, and aligning changes to word boundaries when
/// appropriate.
function presentableDiff(a, b, config) {
    return makePresentable(diff(a, b, config), a, b);
}

/// A chunk describes a range of lines which have changed content in
/// them. Either side (a/b) may either be empty (when its `to` is
/// equal to its `from`), or points at a range starting at the start
/// of the first changed line, to 1 past the end of the last changed
/// line. Note that `to` positions may point past the end of the
/// document. Use `endA`/`endB` if you need an end position that is
/// certain to be a valid document position.
class Chunk {
    constructor(
    /// The individual changes inside this chunk. These are stored
    /// relative to the start of the chunk, so you have to add
    /// `chunk.fromA`/`fromB` to get document positions.
    changes, 
    /// The start of the chunk in document A.
    fromA, 
    /// The end of the chunk in document A. This is equal to `fromA`
    /// when the chunk covers no lines in document A, or is one unit
    /// past the end of the last line in the chunk if it does.
    toA, 
    /// The start of the chunk in document B.
    fromB, 
    /// The end of the chunk in document A.
    toB, 
    /// This is set to false when the diff used to compute this chunk
    /// fell back to fast, imprecise diffing.
    precise = true) {
        this.changes = changes;
        this.fromA = fromA;
        this.toA = toA;
        this.fromB = fromB;
        this.toB = toB;
        this.precise = precise;
    }
    /// @internal
    offset(offA, offB) {
        return offA || offB
            ? new Chunk(this.changes, this.fromA + offA, this.toA + offA, this.fromB + offB, this.toB + offB, this.precise)
            : this;
    }
    /// Returns `fromA` if the chunk is empty in A, or the end of the
    /// last line in the chunk otherwise.
    get endA() { return Math.max(this.fromA, this.toA - 1); }
    /// Returns `fromB` if the chunk is empty in B, or the end of the
    /// last line in the chunk otherwise.
    get endB() { return Math.max(this.fromB, this.toB - 1); }
    /// Build a set of changed chunks for the given documents.
    static build(a, b, conf) {
        let diff = presentableDiff(a.toString(), b.toString(), conf);
        return toChunks(diff, a, b, 0, 0, diffIsPrecise());
    }
    /// Update a set of chunks for changes in document A. `a` should
    /// hold the updated document A.
    static updateA(chunks, a, b, changes, conf) {
        return updateChunks(findRangesForChange(chunks, changes, true, b.length), chunks, a, b, conf);
    }
    /// Update a set of chunks for changes in document B.
    static updateB(chunks, a, b, changes, conf) {
        return updateChunks(findRangesForChange(chunks, changes, false, a.length), chunks, a, b, conf);
    }
}
function fromLine(fromA, fromB, a, b) {
    let lineA = a.lineAt(fromA), lineB = b.lineAt(fromB);
    return lineA.to == fromA && lineB.to == fromB && fromA < a.length && fromB < b.length
        ? [fromA + 1, fromB + 1] : [lineA.from, lineB.from];
}
function toLine(toA, toB, a, b) {
    let lineA = a.lineAt(toA), lineB = b.lineAt(toB);
    return lineA.from == toA && lineB.from == toB ? [toA, toB] : [lineA.to + 1, lineB.to + 1];
}
function toChunks(changes, a, b, offA, offB, precise) {
    let chunks = [];
    for (let i = 0; i < changes.length; i++) {
        let change = changes[i];
        let [fromA, fromB] = fromLine(change.fromA + offA, change.fromB + offB, a, b);
        let [toA, toB] = toLine(change.toA + offA, change.toB + offB, a, b);
        let chunk = [change.offset(-fromA + offA, -fromB + offB)];
        while (i < changes.length - 1) {
            let next = changes[i + 1];
            let [nextA, nextB] = fromLine(next.fromA + offA, next.fromB + offB, a, b);
            if (nextA > toA + 1 && nextB > toB + 1)
                break;
            chunk.push(next.offset(-fromA + offA, -fromB + offB));
            [toA, toB] = toLine(next.toA + offA, next.toB + offB, a, b);
            i++;
        }
        chunks.push(new Chunk(chunk, fromA, Math.max(fromA, toA), fromB, Math.max(fromB, toB), precise));
    }
    return chunks;
}
const updateMargin = 1000;
// Finds the given position in the chunks. Returns the extent of the
// chunk it overlaps with if it overlaps, or a position corresponding
// to that position on both sides otherwise.
function findPos(chunks, pos, isA, start) {
    let lo = 0, hi = chunks.length;
    for (;;) {
        if (lo == hi) {
            let refA = 0, refB = 0;
            if (lo)
                ({ toA: refA, toB: refB } = chunks[lo - 1]);
            let off = pos - (isA ? refA : refB);
            return [refA + off, refB + off];
        }
        let mid = (lo + hi) >> 1, chunk = chunks[mid];
        let [from, to] = isA ? [chunk.fromA, chunk.toA] : [chunk.fromB, chunk.toB];
        if (from > pos)
            hi = mid;
        else if (to <= pos)
            lo = mid + 1;
        else
            return start ? [chunk.fromA, chunk.fromB] : [chunk.toA, chunk.toB];
    }
}
function findRangesForChange(chunks, changes, isA, otherLen) {
    let ranges = [];
    changes.iterChangedRanges((cFromA, cToA, cFromB, cToB) => {
        let fromA = 0, toA = isA ? changes.length : otherLen;
        let fromB = 0, toB = isA ? otherLen : changes.length;
        if (cFromA > updateMargin)
            [fromA, fromB] = findPos(chunks, cFromA - updateMargin, isA, true);
        if (cToA < changes.length - updateMargin)
            [toA, toB] = findPos(chunks, cToA + updateMargin, isA, false);
        let lenDiff = (cToB - cFromB) - (cToA - cFromA), last;
        let [diffA, diffB] = isA ? [lenDiff, 0] : [0, lenDiff];
        if (ranges.length && (last = ranges[ranges.length - 1]).toA >= fromA)
            ranges[ranges.length - 1] = { fromA: last.fromA, fromB: last.fromB, toA, toB,
                diffA: last.diffA + diffA, diffB: last.diffB + diffB };
        else
            ranges.push({ fromA, toA, fromB, toB, diffA, diffB });
    });
    return ranges;
}
function updateChunks(ranges, chunks, a, b, conf) {
    if (!ranges.length)
        return chunks;
    let result = [];
    for (let i = 0, offA = 0, offB = 0, chunkI = 0;; i++) {
        let range = i == ranges.length ? null : ranges[i];
        let fromA = range ? range.fromA + offA : a.length, fromB = range ? range.fromB + offB : b.length;
        while (chunkI < chunks.length) {
            let next = chunks[chunkI];
            if (next.toA + offA > fromA || next.toB + offB > fromB)
                break;
            result.push(next.offset(offA, offB));
            chunkI++;
        }
        if (!range)
            break;
        let toA = range.toA + offA + range.diffA, toB = range.toB + offB + range.diffB;
        let diff = presentableDiff(a.sliceString(fromA, toA), b.sliceString(fromB, toB), conf);
        for (let chunk of toChunks(diff, a, b, fromA, fromB, diffIsPrecise()))
            result.push(chunk);
        offA += range.diffA;
        offB += range.diffB;
        while (chunkI < chunks.length) {
            let next = chunks[chunkI];
            if (next.fromA + offA > toA && next.fromB + offB > toB)
                break;
            chunkI++;
        }
    }
    return result;
}
const defaultDiffConfig = { scanLimit: 500 };

const mergeConfig = state.Facet.define({
    combine: values => values[0]
});
const setChunks = state.StateEffect.define();
const ChunkField = state.StateField.define({
    create(_) {
        return null;
    },
    update(current, tr) {
        for (let e of tr.effects)
            if (e.is(setChunks))
                current = e.value;
        return current;
    }
});
/// Get the changed chunks for the merge view that this editor is part
/// of, plus the side it is on if it is part of a `MergeView`. Returns
/// null if the editor doesn't have a merge extension active or the
/// merge view hasn't finished initializing yet.
function getChunks(state) {
    let field = state.field(ChunkField, false);
    if (!field)
        return null;
    let conf = state.facet(mergeConfig);
    return { chunks: field, side: conf ? conf.side : null };
}
let moveByChunk = (dir) => ({ state: state$1, dispatch }) => {
    let chunks = state$1.field(ChunkField, false), conf = state$1.facet(mergeConfig);
    if (!chunks || !chunks.length || !conf)
        return false;
    let { head } = state$1.selection.main, pos = 0;
    for (let i = chunks.length - 1; i >= 0; i--) {
        let chunk = chunks[i];
        let [from, to] = conf.side == "b" ? [chunk.fromB, chunk.toB] : [chunk.fromA, chunk.toA];
        if (to < head) {
            pos = i + 1;
            break;
        }
        if (from <= head) {
            if (chunks.length == 1)
                return false;
            pos = i + (dir < 0 ? 0 : 1);
            break;
        }
    }
    let next = chunks[(pos + (dir < 0 ? chunks.length - 1 : 0)) % chunks.length];
    let [from, to] = conf.side == "b" ? [next.fromB, next.toB] : [next.fromA, next.toA];
    dispatch(state$1.update({
        selection: { anchor: from },
        userEvent: "select.byChunk",
        effects: view.EditorView.scrollIntoView(state.EditorSelection.range(to, from))
    }));
    return true;
};
/// Move the selection to the next changed chunk.
const goToNextChunk = moveByChunk(1);
/// Move the selection to the previous changed chunk.
const goToPreviousChunk = moveByChunk(-1);

const decorateChunks = view.ViewPlugin.fromClass(class {
    constructor(view) {
        ({ deco: this.deco, gutter: this.gutter } = getChunkDeco(view));
    }
    update(update) {
        if (update.docChanged || update.viewportChanged || chunksChanged(update.startState, update.state) ||
            configChanged(update.startState, update.state))
            ({ deco: this.deco, gutter: this.gutter } = getChunkDeco(update.view));
    }
}, {
    decorations: d => d.deco
});
const changeGutter = state.Prec.low(view.gutter({
    class: "cm-changeGutter",
    markers: view => view.plugin(decorateChunks)?.gutter || state.RangeSet.empty
}));
function chunksChanged(s1, s2) {
    return s1.field(ChunkField, false) != s2.field(ChunkField, false);
}
function configChanged(s1, s2) {
    return s1.facet(mergeConfig) != s2.facet(mergeConfig);
}
const changedLine = view.Decoration.line({ class: "cm-changedLine" });
const changedText = view.Decoration.mark({ class: "cm-changedText" });
const inserted = view.Decoration.mark({ tagName: "ins", class: "cm-insertedLine" });
const deleted = view.Decoration.mark({ tagName: "del", class: "cm-deletedLine" });
const changedLineGutterMarker = new class extends view.GutterMarker {
    constructor() {
        super(...arguments);
        this.elementClass = "cm-changedLineGutter";
    }
};
function buildChunkDeco(chunk, doc, isA, highlight, builder, gutterBuilder) {
    let from = isA ? chunk.fromA : chunk.fromB, to = isA ? chunk.toA : chunk.toB;
    let changeI = 0;
    if (from != to) {
        builder.add(from, from, changedLine);
        builder.add(from, to, isA ? deleted : inserted);
        if (gutterBuilder)
            gutterBuilder.add(from, from, changedLineGutterMarker);
        for (let iter = doc.iterRange(from, to - 1), pos = from; !iter.next().done;) {
            if (iter.lineBreak) {
                pos++;
                builder.add(pos, pos, changedLine);
                if (gutterBuilder)
                    gutterBuilder.add(pos, pos, changedLineGutterMarker);
                continue;
            }
            let lineEnd = pos + iter.value.length;
            if (highlight)
                while (changeI < chunk.changes.length) {
                    let nextChange = chunk.changes[changeI];
                    let nextFrom = from + (isA ? nextChange.fromA : nextChange.fromB);
                    let nextTo = from + (isA ? nextChange.toA : nextChange.toB);
                    let chFrom = Math.max(pos, nextFrom), chTo = Math.min(lineEnd, nextTo);
                    if (chFrom < chTo)
                        builder.add(chFrom, chTo, changedText);
                    if (nextTo < lineEnd)
                        changeI++;
                    else
                        break;
                }
            pos = lineEnd;
        }
    }
}
function getChunkDeco(view) {
    let chunks = view.state.field(ChunkField);
    let { side, highlightChanges, markGutter, overrideChunk } = view.state.facet(mergeConfig), isA = side == "a";
    let builder = new state.RangeSetBuilder();
    let gutterBuilder = markGutter ? new state.RangeSetBuilder() : null;
    let { from, to } = view.viewport;
    for (let chunk of chunks) {
        if ((isA ? chunk.fromA : chunk.fromB) >= to)
            break;
        if ((isA ? chunk.toA : chunk.toB) > from) {
            if (!overrideChunk || !overrideChunk(view.state, chunk, builder, gutterBuilder))
                buildChunkDeco(chunk, view.state.doc, isA, highlightChanges, builder, gutterBuilder);
        }
    }
    return { deco: builder.finish(), gutter: gutterBuilder && gutterBuilder.finish() };
}
class Spacer extends view.WidgetType {
    constructor(height) {
        super();
        this.height = height;
    }
    eq(other) { return this.height == other.height; }
    toDOM() {
        let elt = document.createElement("div");
        elt.className = "cm-mergeSpacer";
        elt.style.height = this.height + "px";
        return elt;
    }
    updateDOM(dom) {
        dom.style.height = this.height + "px";
        return true;
    }
    get estimatedHeight() { return this.height; }
    ignoreEvent() { return false; }
}
const adjustSpacers = state.StateEffect.define({
    map: (value, mapping) => value.map(mapping)
});
const Spacers = state.StateField.define({
    create: () => view.Decoration.none,
    update: (spacers, tr) => {
        for (let e of tr.effects)
            if (e.is(adjustSpacers))
                return e.value;
        return spacers.map(tr.changes);
    },
    provide: f => view.EditorView.decorations.from(f)
});
const epsilon = .01;
function compareSpacers(a, b) {
    if (a.size != b.size)
        return false;
    let iA = a.iter(), iB = b.iter();
    while (iA.value) {
        if (iA.from != iB.from ||
            Math.abs(iA.value.spec.widget.height - iB.value.spec.widget.height) > 1)
            return false;
        iA.next();
        iB.next();
    }
    return true;
}
function updateSpacers(a, b, chunks) {
    let buildA = new state.RangeSetBuilder(), buildB = new state.RangeSetBuilder();
    let spacersA = a.state.field(Spacers).iter(), spacersB = b.state.field(Spacers).iter();
    let posA = 0, posB = 0, offA = 0, offB = 0, vpA = a.viewport, vpB = b.viewport;
    for (let chunkI = 0;; chunkI++) {
        let chunk = chunkI < chunks.length ? chunks[chunkI] : null;
        let endA = chunk ? chunk.fromA : a.state.doc.length, endB = chunk ? chunk.fromB : b.state.doc.length;
        // A range at posA/posB is unchanged, must be aligned.
        if (posA < endA) {
            let heightA = a.lineBlockAt(posA).top + offA;
            let heightB = b.lineBlockAt(posB).top + offB;
            let diff = heightA - heightB;
            if (diff < -epsilon) {
                offA -= diff;
                buildA.add(posA, posA, view.Decoration.widget({
                    widget: new Spacer(-diff),
                    block: true,
                    side: -1
                }));
            }
            else if (diff > epsilon) {
                offB += diff;
                buildB.add(posB, posB, view.Decoration.widget({
                    widget: new Spacer(diff),
                    block: true,
                    side: -1
                }));
            }
        }
        // If the viewport starts inside the unchanged range (on both
        // sides), add another sync at the top of the viewport. That way,
        // big unchanged chunks with possibly inaccurate estimated heights
        // won't cause the content to misalign (#1408)
        if (endA > posA + 1000 && posA < vpA.from && endA > vpA.from && posB < vpB.from && endB > vpB.from) {
            let off = Math.min(vpA.from - posA, vpB.from - posB);
            posA += off;
            posB += off;
            chunkI--;
        }
        else if (!chunk) {
            break;
        }
        else {
            posA = chunk.toA;
            posB = chunk.toB;
        }
        while (spacersA.value && spacersA.from < posA) {
            offA -= spacersA.value.spec.widget.height;
            spacersA.next();
        }
        while (spacersB.value && spacersB.from < posB) {
            offB -= spacersB.value.spec.widget.height;
            spacersB.next();
        }
    }
    while (spacersA.value) {
        offA -= spacersA.value.spec.widget.height;
        spacersA.next();
    }
    while (spacersB.value) {
        offB -= spacersB.value.spec.widget.height;
        spacersB.next();
    }
    let docDiff = (a.contentHeight + offA) - (b.contentHeight + offB);
    if (docDiff < epsilon) {
        buildA.add(a.state.doc.length, a.state.doc.length, view.Decoration.widget({
            widget: new Spacer(-docDiff),
            block: true,
            side: 1
        }));
    }
    else if (docDiff > epsilon) {
        buildB.add(b.state.doc.length, b.state.doc.length, view.Decoration.widget({
            widget: new Spacer(docDiff),
            block: true,
            side: 1
        }));
    }
    let decoA = buildA.finish(), decoB = buildB.finish();
    if (!compareSpacers(decoA, a.state.field(Spacers)))
        a.dispatch({ effects: adjustSpacers.of(decoA) });
    if (!compareSpacers(decoB, b.state.field(Spacers)))
        b.dispatch({ effects: adjustSpacers.of(decoB) });
}
/// A state effect that expands the section of collapsed unchanged
/// code starting at the given position.
const uncollapseUnchanged = state.StateEffect.define({
    map: (value, change) => change.mapPos(value)
});
class CollapseWidget extends view.WidgetType {
    constructor(lines) {
        super();
        this.lines = lines;
    }
    eq(other) { return this.lines == other.lines; }
    toDOM(view) {
        let outer = document.createElement("div");
        outer.className = "cm-collapsedLines";
        outer.textContent = view.state.phrase("$ unchanged lines", this.lines);
        outer.addEventListener("click", e => {
            let pos = view.posAtDOM(e.target);
            view.dispatch({ effects: uncollapseUnchanged.of(pos) });
            let { side, sibling } = view.state.facet(mergeConfig);
            if (sibling)
                sibling().dispatch({ effects: uncollapseUnchanged.of(mapPos(pos, view.state.field(ChunkField), side == "a")) });
        });
        return outer;
    }
    ignoreEvent(e) { return e instanceof MouseEvent; }
    get estimatedHeight() { return 27; }
    get type() { return "collapsed-unchanged-code"; }
}
function mapPos(pos, chunks, isA) {
    let startOur = 0, startOther = 0;
    for (let i = 0;; i++) {
        let next = i < chunks.length ? chunks[i] : null;
        if (!next || (isA ? next.fromA : next.fromB) >= pos)
            return startOther + (pos - startOur);
        [startOur, startOther] = isA ? [next.toA, next.toB] : [next.toB, next.toA];
    }
}
const CollapsedRanges = state.StateField.define({
    create(state) { return view.Decoration.none; },
    update(deco, tr) {
        deco = deco.map(tr.changes);
        for (let e of tr.effects)
            if (e.is(uncollapseUnchanged))
                deco = deco.update({ filter: from => from != e.value });
        return deco;
    },
    provide: f => view.EditorView.decorations.from(f)
});
function collapseUnchanged({ margin = 3, minSize = 4 }) {
    return CollapsedRanges.init(state => buildCollapsedRanges(state, margin, minSize));
}
function buildCollapsedRanges(state$1, margin, minLines) {
    let builder = new state.RangeSetBuilder();
    let isA = state$1.facet(mergeConfig).side == "a";
    let chunks = state$1.field(ChunkField);
    let prevLine = 1;
    for (let i = 0;; i++) {
        let chunk = i < chunks.length ? chunks[i] : null;
        let collapseFrom = i ? prevLine + margin : 1;
        let collapseTo = chunk ? state$1.doc.lineAt(isA ? chunk.fromA : chunk.fromB).number - 1 - margin : state$1.doc.lines;
        let lines = collapseTo - collapseFrom + 1;
        if (lines >= minLines) {
            builder.add(state$1.doc.line(collapseFrom).from, state$1.doc.line(collapseTo).to, view.Decoration.replace({
                widget: new CollapseWidget(lines),
                block: true
            }));
        }
        if (!chunk)
            break;
        prevLine = state$1.doc.lineAt(Math.min(state$1.doc.length, isA ? chunk.toA : chunk.toB)).number;
    }
    return builder.finish();
}

const C = "\u037c";
const COUNT = typeof Symbol == "undefined" ? "__" + C : Symbol.for(C);
const SET = typeof Symbol == "undefined" ? "__styleSet" + Math.floor(Math.random() * 1e8) : Symbol("styleSet");
const top = typeof globalThis != "undefined" ? globalThis : typeof window != "undefined" ? window : {};

// :: - Style modules encapsulate a set of CSS rules defined from
// JavaScript. Their definitions are only available in a given DOM
// root after it has been _mounted_ there with `StyleModule.mount`.
//
// Style modules should be created once and stored somewhere, as
// opposed to re-creating them every time you need them. The amount of
// CSS rules generated for a given DOM root is bounded by the amount
// of style modules that were used. So to avoid leaking rules, don't
// create these dynamically, but treat them as one-time allocations.
class StyleModule {
  // :: (Object<Style>, ?{finish: ?(string) → string})
  // Create a style module from the given spec.
  //
  // When `finish` is given, it is called on regular (non-`@`)
  // selectors (after `&` expansion) to compute the final selector.
  constructor(spec, options) {
    this.rules = [];
    let {finish} = options || {};

    function splitSelector(selector) {
      return /^@/.test(selector) ? [selector] : selector.split(/,\s*/)
    }

    function render(selectors, spec, target, isKeyframes) {
      let local = [], isAt = /^@(\w+)\b/.exec(selectors[0]), keyframes = isAt && isAt[1] == "keyframes";
      if (isAt && spec == null) return target.push(selectors[0] + ";")
      for (let prop in spec) {
        let value = spec[prop];
        if (/&/.test(prop)) {
          render(prop.split(/,\s*/).map(part => selectors.map(sel => part.replace(/&/, sel))).reduce((a, b) => a.concat(b)),
                 value, target);
        } else if (value && typeof value == "object") {
          if (!isAt) throw new RangeError("The value of a property (" + prop + ") should be a primitive value.")
          render(splitSelector(prop), value, local, keyframes);
        } else if (value != null) {
          local.push(prop.replace(/_.*/, "").replace(/[A-Z]/g, l => "-" + l.toLowerCase()) + ": " + value + ";");
        }
      }
      if (local.length || keyframes) {
        target.push((finish && !isAt && !isKeyframes ? selectors.map(finish) : selectors).join(", ") +
                    " {" + local.join(" ") + "}");
      }
    }

    for (let prop in spec) render(splitSelector(prop), spec[prop], this.rules);
  }

  // :: () → string
  // Returns a string containing the module's CSS rules.
  getRules() { return this.rules.join("\n") }

  // :: () → string
  // Generate a new unique CSS class name.
  static newName() {
    let id = top[COUNT] || 1;
    top[COUNT] = id + 1;
    return C + id.toString(36)
  }

  // :: (union<Document, ShadowRoot>, union<[StyleModule], StyleModule>, ?{nonce: ?string})
  //
  // Mount the given set of modules in the given DOM root, which ensures
  // that the CSS rules defined by the module are available in that
  // context.
  //
  // Rules are only added to the document once per root.
  //
  // Rule order will follow the order of the modules, so that rules from
  // modules later in the array take precedence of those from earlier
  // modules. If you call this function multiple times for the same root
  // in a way that changes the order of already mounted modules, the old
  // order will be changed.
  //
  // If a Content Security Policy nonce is provided, it is added to
  // the `<style>` tag generated by the library.
  static mount(root, modules, options) {
    let set = root[SET], nonce = options && options.nonce;
    if (!set) set = new StyleSet(root, nonce);
    else if (nonce) set.setNonce(nonce);
    set.mount(Array.isArray(modules) ? modules : [modules], root);
  }
}

let adoptedSet = new Map; //<Document, StyleSet>

class StyleSet {
  constructor(root, nonce) {
    let doc = root.ownerDocument || root, win = doc.defaultView;
    if (!root.head && root.adoptedStyleSheets && win.CSSStyleSheet) {
      let adopted = adoptedSet.get(doc);
      if (adopted) return root[SET] = adopted
      this.sheet = new win.CSSStyleSheet;
      adoptedSet.set(doc, this);
    } else {
      this.styleTag = doc.createElement("style");
      if (nonce) this.styleTag.setAttribute("nonce", nonce);
    }
    this.modules = [];
    root[SET] = this;
  }

  mount(modules, root) {
    let sheet = this.sheet;
    let pos = 0 /* Current rule offset */, j = 0; /* Index into this.modules */
    for (let i = 0; i < modules.length; i++) {
      let mod = modules[i], index = this.modules.indexOf(mod);
      if (index < j && index > -1) { // Ordering conflict
        this.modules.splice(index, 1);
        j--;
        index = -1;
      }
      if (index == -1) {
        this.modules.splice(j++, 0, mod);
        if (sheet) for (let k = 0; k < mod.rules.length; k++)
          sheet.insertRule(mod.rules[k], pos++);
      } else {
        while (j < index) pos += this.modules[j++].rules.length;
        pos += mod.rules.length;
        j++;
      }
    }

    if (sheet) {
      if (root.adoptedStyleSheets.indexOf(this.sheet) < 0)
        root.adoptedStyleSheets = [this.sheet, ...root.adoptedStyleSheets];
    } else {
      let text = "";
      for (let i = 0; i < this.modules.length; i++)
        text += this.modules[i].getRules() + "\n";
      this.styleTag.textContent = text;
      let target = root.head || root;
      if (this.styleTag.parentNode != target)
        target.insertBefore(this.styleTag, target.firstChild);
    }
  }

  setNonce(nonce) {
    if (this.styleTag && this.styleTag.getAttribute("nonce") != nonce)
      this.styleTag.setAttribute("nonce", nonce);
  }
}

// Style::Object<union<Style,string>>
//
// A style is an object that, in the simple case, maps CSS property
// names to strings holding their values, as in `{color: "red",
// fontWeight: "bold"}`. The property names can be given in
// camel-case—the library will insert a dash before capital letters
// when converting them to CSS.
//
// If you include an underscore in a property name, it and everything
// after it will be removed from the output, which can be useful when
// providing a property multiple times, for browser compatibility
// reasons.
//
// A property in a style object can also be a sub-selector, which
// extends the current context to add a pseudo-selector or a child
// selector. Such a property should contain a `&` character, which
// will be replaced by the current selector. For example `{"&:before":
// {content: '"hi"'}}`. Sub-selectors and regular properties can
// freely be mixed in a given object. Any property containing a `&` is
// assumed to be a sub-selector.
//
// Finally, a property can specify an @-block to be wrapped around the
// styles defined inside the object that's the property's value. For
// example to create a media query you can do `{"@media screen and
// (min-width: 400px)": {...}}`.

const externalTheme = view.EditorView.styleModule.of(new StyleModule({
    ".cm-mergeView": {
        overflowY: "auto",
    },
    ".cm-mergeViewEditors": {
        display: "flex",
        alignItems: "stretch",
    },
    ".cm-mergeViewEditor": {
        flexGrow: 1,
        flexBasis: 0,
        overflow: "hidden"
    },
    ".cm-merge-revert": {
        width: "1.6em",
        flexGrow: 0,
        flexShrink: 0,
        position: "relative"
    },
    ".cm-merge-revert button": {
        position: "absolute",
        display: "block",
        width: "100%",
        boxSizing: "border-box",
        textAlign: "center",
        background: "none",
        border: "none",
        font: "inherit",
        cursor: "pointer"
    }
}));
const baseTheme = view.EditorView.baseTheme({
    ".cm-mergeView & .cm-scroller, .cm-mergeView &": {
        height: "auto !important",
        overflowY: "visible !important"
    },
    "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": {
        backgroundColor: "rgba(160, 128, 100, .08)"
    },
    "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": {
        backgroundColor: "rgba(100, 160, 128, .08)"
    },
    "&light.cm-merge-a .cm-changedText, &light .cm-deletedChunk .cm-deletedText": {
        background: "linear-gradient(#ee443366, #ee443366) bottom/100% 2px no-repeat",
    },
    "&dark.cm-merge-a .cm-changedText, &dark .cm-deletedChunk .cm-deletedText": {
        background: "linear-gradient(#ffaa9966, #ffaa9966) bottom/100% 2px no-repeat",
    },
    "&light.cm-merge-b .cm-changedText": {
        background: "linear-gradient(#22bb22aa, #22bb22aa) bottom/100% 2px no-repeat",
    },
    "&dark.cm-merge-b .cm-changedText": {
        background: "linear-gradient(#88ff88aa, #88ff88aa) bottom/100% 2px no-repeat",
    },
    "&.cm-merge-b .cm-deletedText": {
        background: "#ff000033"
    },
    ".cm-insertedLine, .cm-deletedLine, .cm-deletedLine del": {
        textDecoration: "none"
    },
    ".cm-deletedChunk": {
        paddingLeft: "6px",
        "& .cm-chunkButtons": {
            position: "absolute",
            insetInlineEnd: "5px"
        },
        "& button": {
            border: "none",
            cursor: "pointer",
            color: "white",
            margin: "0 2px",
            borderRadius: "3px",
            "&[name=accept]": { background: "#2a2" },
            "&[name=reject]": { background: "#d43" }
        },
    },
    ".cm-collapsedLines": {
        padding: "5px 5px 5px 10px",
        cursor: "pointer",
        "&:before": {
            content: '"⦚"',
            marginInlineEnd: "7px"
        },
        "&:after": {
            content: '"⦚"',
            marginInlineStart: "7px"
        },
    },
    "&light .cm-collapsedLines": {
        color: "#444",
        background: "linear-gradient(to bottom, transparent 0, #f3f3f3 30%, #f3f3f3 70%, transparent 100%)"
    },
    "&dark .cm-collapsedLines": {
        color: "#ddd",
        background: "linear-gradient(to bottom, transparent 0, #222 30%, #222 70%, transparent 100%)"
    },
    ".cm-changeGutter": { width: "3px", paddingLeft: "1px" },
    "&light.cm-merge-a .cm-changedLineGutter, &light .cm-deletedLineGutter": { background: "#e43" },
    "&dark.cm-merge-a .cm-changedLineGutter, &dark .cm-deletedLineGutter": { background: "#fa9" },
    "&light.cm-merge-b .cm-changedLineGutter": { background: "#2b2" },
    "&dark.cm-merge-b .cm-changedLineGutter": { background: "#8f8" },
    ".cm-inlineChangedLineGutter": { background: "#75d" }
});

/// Create a keymap extension for merge views with configurable undo/redo commands
function mergeKeymap(undoCommand, redoCommand, config = {}) {
    const undoKey = config.undo || "Mod-z";
    const redoKeys = Array.isArray(config.redo)
        ? config.redo
        : config.redo
            ? [config.redo]
            : ["Mod-y", "Mod-Shift-z"];
    const bindings = [
        { key: undoKey, run: undoCommand }
    ];
    for (const redoKey of redoKeys) {
        bindings.push({ key: redoKey, run: redoCommand });
    }
    const keymapExt = view.keymap.of(bindings);
    return config.highPrecedence !== false
        ? state.Prec.highest(keymapExt)
        : keymapExt;
}
/// Default merge keymap with standard Ctrl/Cmd+Z and Ctrl/Cmd+Y bindings
function defaultMergeKeymap(undoCommand, redoCommand) {
    return mergeKeymap(undoCommand, redoCommand);
}

// Shared history state for unified undo/redo with grouping support
class SharedHistory {
    constructor() {
        this.history = [];
        this.currentIndex = -1;
        this.lastUndoTimestamp = 0;
        this.lastRedoTimestamp = 0;
        this.groupTimeoutMs = 1000;
    }
    addTransaction(editor, transaction) {
        console.log(`Adding transaction for editor ${editor}`);
        // Remove any future history when adding new transaction
        this.history = this.history.slice(0, this.currentIndex + 1);
        this.history.push({ editor, transaction, timestamp: Date.now() });
        this.currentIndex++;
    }
    canUndo() {
        return this.currentIndex >= 0;
    }
    canRedo() {
        return this.currentIndex < this.history.length - 1;
    }
    // Get the range of transactions that should be grouped together for undo
    getUndoGroup() {
        if (!this.canUndo())
            return null;
        const endIndex = this.currentIndex;
        let startIndex = endIndex;
        // Group transactions based on their original timestamps
        // Walk backwards from the current position
        while (startIndex > 0) {
            const prevEntry = this.history[startIndex - 1];
            const currentEntry = this.history[startIndex];
            // Group if:
            // 1. Transactions are within the timeout window of each other
            // 2. Same editor
            if (currentEntry.timestamp - prevEntry.timestamp <= this.groupTimeoutMs &&
                prevEntry.editor === currentEntry.editor) {
                startIndex--;
            }
            else {
                break;
            }
        }
        return { startIndex, endIndex };
    }
    // Get the range of transactions that should be grouped together for redo
    getRedoGroup() {
        if (!this.canRedo())
            return null;
        const startIndex = this.currentIndex + 1;
        let endIndex = startIndex;
        // Group transactions based on their original timestamps
        // Walk forwards from the redo position
        while (endIndex < this.history.length - 1) {
            const currentEntry = this.history[endIndex];
            const nextEntry = this.history[endIndex + 1];
            // Group if:
            // 1. Transactions are within the timeout window of each other
            // 2. Same editor
            if (nextEntry.timestamp - currentEntry.timestamp <= this.groupTimeoutMs &&
                nextEntry.editor === currentEntry.editor) {
                endIndex++;
            }
            else {
                break;
            }
        }
        return { startIndex, endIndex };
    }
    // Undo a group of transactions
    undoGroup() {
        const group = this.getUndoGroup();
        if (!group) {
            return null;
        }
        const result = [];
        // Group transactions by editor
        let currentEditor = this.history[group.startIndex].editor;
        let currentTransactions = [];
        for (let i = group.startIndex; i <= group.endIndex; i++) {
            const entry = this.history[i];
            if (entry.editor !== currentEditor) {
                result.push({
                    editor: currentEditor,
                    transactions: currentTransactions,
                });
                currentEditor = entry.editor;
                currentTransactions = [entry.transaction];
            }
            else {
                currentTransactions.push(entry.transaction);
            }
        }
        // Add the last group
        if (currentTransactions.length > 0) {
            result.push({ editor: currentEditor, transactions: currentTransactions });
        }
        // Update state
        this.currentIndex = group.startIndex - 1;
        this.lastUndoTimestamp = Date.now();
        return result;
    }
    // Redo a group of transactions
    redoGroup() {
        const group = this.getRedoGroup();
        if (!group) {
            return null;
        }
        const result = [];
        // Group transactions by editor
        let currentEditor = this.history[group.startIndex].editor;
        let currentTransactions = [];
        for (let i = group.startIndex; i <= group.endIndex; i++) {
            const entry = this.history[i];
            if (entry.editor !== currentEditor) {
                result.push({
                    editor: currentEditor,
                    transactions: currentTransactions,
                });
                currentEditor = entry.editor;
                currentTransactions = [entry.transaction];
            }
            else {
                currentTransactions.push(entry.transaction);
            }
        }
        // Add the last group
        if (currentTransactions.length > 0) {
            result.push({ editor: currentEditor, transactions: currentTransactions });
        }
        // Update state
        this.currentIndex = group.endIndex;
        this.lastRedoTimestamp = Date.now();
        return result;
    }
    // Single undo (backwards compatible)
    undo() {
        const result = this.history[this.currentIndex];
        this.currentIndex--;
        this.lastUndoTimestamp = Date.now();
        return result;
    }
    // Single redo (backwards compatible)
    redo() {
        if (!this.canRedo()) {
            return null;
        }
        this.currentIndex++;
        const result = this.history[this.currentIndex];
        this.lastRedoTimestamp = Date.now();
        return result;
    }
    // Get information about what would be undone/redone
    peekUndo() {
        const group = this.getUndoGroup();
        if (!group)
            return null;
        const editors = new Set();
        for (let i = group.startIndex; i <= group.endIndex; i++) {
            editors.add(this.history[i].editor);
        }
        return {
            count: group.endIndex - group.startIndex + 1,
            editors,
        };
    }
    peekRedo() {
        const group = this.getRedoGroup();
        if (!group)
            return null;
        const editors = new Set();
        for (let i = group.startIndex; i <= group.endIndex; i++) {
            editors.add(this.history[i].editor);
        }
        return {
            count: group.endIndex - group.startIndex + 1,
            editors,
        };
    }
    // Clear history
    clear() {
        this.history = [];
        this.currentIndex = -1;
        this.lastUndoTimestamp = 0;
        this.lastRedoTimestamp = 0;
    }
    // Get current state info
    getState() {
        return {
            historyLength: this.history.length,
            currentIndex: this.currentIndex,
            canUndo: this.canUndo(),
            canRedo: this.canRedo(),
            lastUndoTimestamp: this.lastUndoTimestamp,
            lastRedoTimestamp: this.lastRedoTimestamp,
        };
    }
}
const collapseCompartment = new state.Compartment(), configCompartment = new state.Compartment(), keymapCompartment = new state.Compartment();
/// A merge view manages two editors side-by-side, highlighting the
/// difference between them and vertically aligning unchanged lines.
/// If you want one of the editors to be read-only, you have to
/// configure that in its extensions.
///
/// By default, views are not scrollable. Style them (`.cm-mergeView`)
/// with a height and `overflow: auto` to make them scrollable.
class MergeView {
    /// Create a new merge view.
    constructor(config) {
        this.revertDOM = null;
        this.revertToA = false;
        this.revertToLeft = false;
        this.sharedHistory = new SharedHistory();
        this.measuring = -1;
        this.diffConf = config.diffConfig || defaultDiffConfig;
        // Create unified undo/redo commands
        const unifiedUndo = () => {
            console.log("🔄 UNIFIED UNDO CALLED - Our custom implementation");
            console.log("SharedHistory state before undo:", this.sharedHistory.getState());
            const historyGroups = this.sharedHistory.undoGroup();
            if (historyGroups && historyGroups.length > 0) {
                console.log(`Found ${historyGroups.length} editor groups to undo:`, historyGroups.map((g) => `${g.editor}: ${g.transactions.length} transactions`));
                // Apply undo transactions in reverse order (most recent first)
                for (const { editor, transactions } of historyGroups.reverse()) {
                    const targetEditor = editor === "a" ? this.a : this.b;
                    console.log(`Undoing ${transactions.length} transactions from editor ${editor}`);
                    // Apply transactions in reverse order within each editor group
                    for (const transaction of transactions.reverse()) {
                        console.log(`  - Undoing transaction with ${transaction.changes.length} changes`);
                        // Create inverse transaction to undo the change
                        const inverseChanges = transaction.changes.invert(transaction.startState.doc);
                        targetEditor.dispatch({
                            changes: inverseChanges,
                            userEvent: "undo",
                            annotations: [state.Transaction.addToHistory.of(false)],
                        });
                    }
                }
                console.log("SharedHistory state after undo:", this.sharedHistory.getState());
                return true;
            }
            else {
                console.log("No history groups to undo");
            }
            return false;
        };
        const unifiedRedo = () => {
            console.log("🔄 UNIFIED REDO CALLED - Our custom implementation");
            console.log("SharedHistory state before redo:", this.sharedHistory.getState());
            const historyGroups = this.sharedHistory.redoGroup();
            if (historyGroups && historyGroups.length > 0) {
                console.log(`Found ${historyGroups.length} editor groups to redo:`, historyGroups.map((g) => `${g.editor}: ${g.transactions.length} transactions`));
                // Apply redo transactions in original order
                for (const { editor, transactions } of historyGroups) {
                    const targetEditor = editor === "a" ? this.a : this.b;
                    console.log(`Redoing ${transactions.length} transactions from editor ${editor}`);
                    // Apply transactions in original order within each editor group
                    for (const transaction of transactions) {
                        console.log(`  - Redoing transaction with ${transaction.changes.length} changes`);
                        // Re-apply the original changes
                        targetEditor.dispatch({
                            changes: transaction.changes,
                            userEvent: "redo",
                            annotations: [state.Transaction.addToHistory.of(false)],
                        });
                    }
                }
                console.log("SharedHistory state after redo:", this.sharedHistory.getState());
                return true;
            }
            else {
                console.log("No history groups to redo");
            }
            return false;
        };
        // Create configurable keymap
        const keymapConfig = config.keymap === false
            ? []
            : config.keymap
                ? mergeKeymap(unifiedUndo, unifiedRedo, config.keymap)
                : defaultMergeKeymap(unifiedUndo, unifiedRedo);
        let sharedExtensions = [
            state.Prec.low(decorateChunks),
            baseTheme,
            externalTheme,
            Spacers,
            keymapCompartment.of(keymapConfig),
            view.EditorView.updateListener.of((update) => {
                if (this.measuring < 0 &&
                    (update.heightChanged || update.viewportChanged) &&
                    !update.transactions.some((tr) => tr.effects.some((e) => e.is(adjustSpacers))))
                    this.measure();
            }),
        ];
        let configA = [
            mergeConfig.of({
                side: "a",
                sibling: () => this.b,
                highlightChanges: config.highlightChanges !== false,
                markGutter: config.gutter !== false,
            }),
        ];
        if (config.gutter !== false)
            configA.push(changeGutter);
        let stateA = state.EditorState.create({
            doc: config.a.doc,
            selection: config.a.selection,
            extensions: [
                config.a.extensions || [],
                view.EditorView.editorAttributes.of({ class: "cm-merge-a" }),
                configCompartment.of(configA),
                // Remove individual history - we'll handle it ourselves
                sharedExtensions,
            ],
        });
        let configB = [
            mergeConfig.of({
                side: "b",
                sibling: () => this.a,
                highlightChanges: config.highlightChanges !== false,
                markGutter: config.gutter !== false,
            }),
        ];
        if (config.gutter !== false)
            configB.push(changeGutter);
        let stateB = state.EditorState.create({
            doc: config.b.doc,
            selection: config.b.selection,
            extensions: [
                config.b.extensions || [],
                view.EditorView.editorAttributes.of({ class: "cm-merge-b" }),
                configCompartment.of(configB),
                // Remove individual history - we'll handle it ourselves
                sharedExtensions,
            ],
        });
        this.chunks = Chunk.build(stateA.doc, stateB.doc, this.diffConf);
        let add = [
            ChunkField.init(() => this.chunks),
            collapseCompartment.of(config.collapseUnchanged
                ? collapseUnchanged(config.collapseUnchanged)
                : []),
        ];
        stateA = stateA.update({ effects: state.StateEffect.appendConfig.of(add) }).state;
        stateB = stateB.update({ effects: state.StateEffect.appendConfig.of(add) }).state;
        this.dom = document.createElement("div");
        this.dom.className = "cm-mergeView";
        this.editorDOM = this.dom.appendChild(document.createElement("div"));
        this.editorDOM.className = "cm-mergeViewEditors";
        let orientation = config.orientation || "a-b";
        let wrapA = document.createElement("div");
        wrapA.className = "cm-mergeViewEditor";
        let wrapB = document.createElement("div");
        wrapB.className = "cm-mergeViewEditor";
        this.editorDOM.appendChild(orientation == "a-b" ? wrapA : wrapB);
        this.editorDOM.appendChild(orientation == "a-b" ? wrapB : wrapA);
        this.a = new view.EditorView({
            state: stateA,
            parent: wrapA,
            root: config.root,
            dispatchTransactions: (trs) => this.dispatch(trs, this.a),
        });
        this.b = new view.EditorView({
            state: stateB,
            parent: wrapB,
            root: config.root,
            dispatchTransactions: (trs) => this.dispatch(trs, this.b),
        });
        this.setupRevertControls(!!config.revertControls, config.revertControls == "b-to-a", config.renderRevertControl);
        if (config.parent)
            config.parent.appendChild(this.dom);
        this.scheduleMeasure();
    }
    dispatch(trs, target) {
        if (trs.some((tr) => tr.docChanged)) {
            let last = trs[trs.length - 1];
            let changes = trs.reduce((chs, tr) => chs.compose(tr.changes), state.ChangeSet.empty(trs[0].startState.doc.length));
            // Check if this is an undo/redo transaction - don't add to history
            const userEvent = last.annotation(state.Transaction.userEvent);
            const addToHistory = last.annotation(state.Transaction.addToHistory);
            const isUndoRedo = userEvent === "undo" || userEvent === "redo" || addToHistory === false;
            console.log(`Dispatch: editor ${target === this.a ? "a" : "b"}, userEvent: ${userEvent}, addToHistory: ${addToHistory}, isUndoRedo: ${isUndoRedo}`);
            // Only add to shared history if it's not an undo/redo operation
            if (!isUndoRedo) {
                this.sharedHistory.addTransaction(target === this.a ? "a" : "b", last);
            }
            else {
                console.log("Skipping history addition for undo/redo transaction");
            }
            this.chunks =
                target == this.a
                    ? Chunk.updateA(this.chunks, last.newDoc, this.b.state.doc, changes, this.diffConf)
                    : Chunk.updateB(this.chunks, this.a.state.doc, last.newDoc, changes, this.diffConf);
            target.update([
                ...trs,
                last.state.update({ effects: setChunks.of(this.chunks) }),
            ]);
            let other = target == this.a ? this.b : this.a;
            other.update([
                other.state.update({ effects: setChunks.of(this.chunks) }),
            ]);
            this.scheduleMeasure();
        }
        else {
            target.update(trs);
        }
    }
    /// Reconfigure an existing merge view.
    reconfigure(config) {
        if ("diffConfig" in config) {
            this.diffConf = config.diffConfig;
        }
        if ("orientation" in config) {
            let aB = config.orientation != "b-a";
            if (aB != (this.editorDOM.firstChild == this.a.dom.parentNode)) {
                let domA = this.a.dom.parentNode, domB = this.b.dom.parentNode;
                domA.remove();
                domB.remove();
                this.editorDOM.insertBefore(aB ? domA : domB, this.editorDOM.firstChild);
                this.editorDOM.appendChild(aB ? domB : domA);
                this.revertToLeft = !this.revertToLeft;
                if (this.revertDOM)
                    this.revertDOM.textContent = "";
            }
        }
        if ("revertControls" in config || "renderRevertControl" in config) {
            let controls = !!this.revertDOM, toA = this.revertToA, render = this.renderRevert;
            if ("revertControls" in config) {
                controls = !!config.revertControls;
                toA = config.revertControls == "b-to-a";
            }
            if ("renderRevertControl" in config)
                render = config.renderRevertControl;
            this.setupRevertControls(controls, toA, render);
        }
        // Handle keymap reconfiguration
        if ("keymap" in config) {
            const unifiedUndo = () => {
                const historyGroups = this.sharedHistory.undoGroup();
                if (historyGroups && historyGroups.length > 0) {
                    for (const { editor, transactions } of historyGroups.reverse()) {
                        const targetEditor = editor === "a" ? this.a : this.b;
                        for (const transaction of transactions.reverse()) {
                            const inverseChanges = transaction.changes.invert(transaction.startState.doc);
                            targetEditor.dispatch({
                                changes: inverseChanges,
                                userEvent: "undo",
                                annotations: [state.Transaction.addToHistory.of(false)],
                            });
                        }
                    }
                    return true;
                }
                return false;
            };
            const unifiedRedo = () => {
                const historyGroups = this.sharedHistory.redoGroup();
                if (historyGroups && historyGroups.length > 0) {
                    for (const { editor, transactions } of historyGroups) {
                        const targetEditor = editor === "a" ? this.a : this.b;
                        for (const transaction of transactions) {
                            targetEditor.dispatch({
                                changes: transaction.changes,
                                userEvent: "redo",
                                annotations: [state.Transaction.addToHistory.of(false)],
                            });
                        }
                    }
                    return true;
                }
                return false;
            };
            const keymapConfig = config.keymap === false
                ? []
                : config.keymap
                    ? mergeKeymap(unifiedUndo, unifiedRedo, config.keymap)
                    : defaultMergeKeymap(unifiedUndo, unifiedRedo);
            this.a.dispatch({ effects: keymapCompartment.reconfigure(keymapConfig) });
            this.b.dispatch({ effects: keymapCompartment.reconfigure(keymapConfig) });
        }
        let highlight = "highlightChanges" in config, gutter = "gutter" in config, collapse = "collapseUnchanged" in config;
        if (highlight || gutter || collapse) {
            let effectsA = [], effectsB = [];
            if (highlight || gutter) {
                let currentConfig = this.a.state.facet(mergeConfig);
                let markGutter = gutter
                    ? config.gutter !== false
                    : currentConfig.markGutter;
                let highlightChanges = highlight
                    ? config.highlightChanges !== false
                    : currentConfig.highlightChanges;
                effectsA.push(configCompartment.reconfigure([
                    mergeConfig.of({
                        side: "a",
                        sibling: () => this.b,
                        highlightChanges,
                        markGutter,
                    }),
                    markGutter ? changeGutter : [],
                ]));
                effectsB.push(configCompartment.reconfigure([
                    mergeConfig.of({
                        side: "b",
                        sibling: () => this.a,
                        highlightChanges,
                        markGutter,
                    }),
                    markGutter ? changeGutter : [],
                ]));
            }
            if (collapse) {
                let effect = collapseCompartment.reconfigure(config.collapseUnchanged
                    ? collapseUnchanged(config.collapseUnchanged)
                    : []);
                effectsA.push(effect);
                effectsB.push(effect);
            }
            this.a.dispatch({ effects: effectsA });
            this.b.dispatch({ effects: effectsB });
        }
        this.scheduleMeasure();
    }
    setupRevertControls(controls, toA, render) {
        this.revertToA = toA;
        this.revertToLeft =
            this.revertToA == (this.editorDOM.firstChild == this.a.dom.parentNode);
        this.renderRevert = render;
        if (!controls && this.revertDOM) {
            this.revertDOM.remove();
            this.revertDOM = null;
        }
        else if (controls && !this.revertDOM) {
            this.revertDOM = this.editorDOM.insertBefore(document.createElement("div"), this.editorDOM.firstChild.nextSibling);
            this.revertDOM.addEventListener("mousedown", (e) => this.revertClicked(e));
            this.revertDOM.className = "cm-merge-revert";
        }
        else if (this.revertDOM) {
            this.revertDOM.textContent = "";
        }
    }
    scheduleMeasure() {
        if (this.measuring < 0) {
            let win = this.dom.ownerDocument.defaultView || window;
            this.measuring = win.requestAnimationFrame(() => {
                this.measuring = -1;
                this.measure();
            });
        }
    }
    measure() {
        updateSpacers(this.a, this.b, this.chunks);
        if (this.revertDOM)
            this.updateRevertButtons();
    }
    updateRevertButtons() {
        let dom = this.revertDOM, next = dom.firstChild;
        let vpA = this.a.viewport, vpB = this.b.viewport;
        for (let i = 0; i < this.chunks.length; i++) {
            let chunk = this.chunks[i];
            if (chunk.fromA > vpA.to || chunk.fromB > vpB.to)
                break;
            if (chunk.fromA < vpA.from || chunk.fromB < vpB.from)
                continue;
            let top = this.a.lineBlockAt(chunk.fromA).top + "px";
            while (next && +next.dataset.chunk < i)
                next = rm(next);
            if (next && next.dataset.chunk == String(i)) {
                if (next.style.top != top)
                    next.style.top = top;
                next = next.nextSibling;
            }
            else {
                dom.insertBefore(this.renderRevertButton(top, i), next);
            }
        }
        while (next)
            next = rm(next);
    }
    renderRevertButton(top, chunk) {
        let elt;
        if (this.renderRevert) {
            elt = this.renderRevert();
        }
        else {
            elt = document.createElement("button");
            let text = this.a.state.phrase("Revert this chunk");
            elt.setAttribute("aria-label", text);
            elt.setAttribute("title", text);
            elt.textContent = this.revertToLeft ? "⇜" : "⇝";
        }
        elt.style.top = top;
        elt.setAttribute("data-chunk", String(chunk));
        return elt;
    }
    revertClicked(e) {
        let target = e.target, chunk;
        while (target && target.parentNode != this.revertDOM)
            target = target.parentNode;
        if (target && (chunk = this.chunks[target.dataset.chunk])) {
            let [source, dest, srcFrom, srcTo, destFrom, destTo] = this.revertToA
                ? [this.b, this.a, chunk.fromB, chunk.toB, chunk.fromA, chunk.toA]
                : [this.a, this.b, chunk.fromA, chunk.toA, chunk.fromB, chunk.toB];
            let insert = source.state.sliceDoc(srcFrom, Math.max(srcFrom, srcTo - 1));
            if (srcFrom != srcTo && destTo <= dest.state.doc.length)
                insert += source.state.lineBreak;
            dest.dispatch({
                changes: {
                    from: destFrom,
                    to: Math.min(dest.state.doc.length, destTo),
                    insert,
                },
                userEvent: "revert",
            });
            e.preventDefault();
        }
    }
    /// Destroy this merge view.
    destroy() {
        this.a.destroy();
        this.b.destroy();
        if (this.measuring > -1)
            (this.dom.ownerDocument.defaultView || window).cancelAnimationFrame(this.measuring);
        this.dom.remove();
    }
}
/// Accept all chunks in a merge view in a single transaction.
/// This allows undoing all accepts as one operation and is more efficient
/// than accepting chunks individually.
function acceptAllChunksMergeView(mergeView, direction = "a-to-b") {
    const chunks = mergeView.chunks;
    if (!chunks || chunks.length === 0)
        return false;
    const [source, dest] = direction === "a-to-b"
        ? [mergeView.a, mergeView.b]
        : [mergeView.b, mergeView.a];
    let changes = [];
    // Process chunks in reverse order to maintain correct positions
    for (let i = chunks.length - 1; i >= 0; i--) {
        const chunk = chunks[i];
        const [srcFrom, srcTo, destFrom, destTo] = direction === "a-to-b"
            ? [chunk.fromA, chunk.toA, chunk.fromB, chunk.toB]
            : [chunk.fromB, chunk.toB, chunk.fromA, chunk.toA];
        let insert = source.state.sliceDoc(srcFrom, Math.max(srcFrom, srcTo - 1));
        if (srcFrom != srcTo && destTo <= dest.state.doc.length) {
            insert += source.state.lineBreak;
        }
        changes.push({
            from: destFrom,
            to: Math.min(dest.state.doc.length, destTo),
            insert,
        });
    }
    // Apply all changes in a single transaction
    dest.dispatch({
        changes,
        userEvent: "revert.all",
    });
    return true;
}
function rm(elt) {
    let next = elt.nextSibling;
    elt.remove();
    return next;
}

/**
The default maximum length of a `TreeBuffer` node.
*/
const DefaultBufferLength = 1024;
let nextPropID = 0;
/**
Each [node type](#common.NodeType) or [individual tree](#common.Tree)
can have metadata associated with it in props. Instances of this
class represent prop names.
*/
class NodeProp {
    /**
    Create a new node prop type.
    */
    constructor(config = {}) {
        this.id = nextPropID++;
        this.perNode = !!config.perNode;
        this.deserialize = config.deserialize || (() => {
            throw new Error("This node type doesn't define a deserialize function");
        });
    }
    /**
    This is meant to be used with
    [`NodeSet.extend`](#common.NodeSet.extend) or
    [`LRParser.configure`](#lr.ParserConfig.props) to compute
    prop values for each node type in the set. Takes a [match
    object](#common.NodeType^match) or function that returns undefined
    if the node type doesn't get this prop, and the prop's value if
    it does.
    */
    add(match) {
        if (this.perNode)
            throw new RangeError("Can't add per-node props to node types");
        if (typeof match != "function")
            match = NodeType.match(match);
        return (type) => {
            let result = match(type);
            return result === undefined ? null : [this, result];
        };
    }
}
/**
Prop that is used to describe matching delimiters. For opening
delimiters, this holds an array of node names (written as a
space-separated string when declaring this prop in a grammar)
for the node types of closing delimiters that match it.
*/
NodeProp.closedBy = new NodeProp({ deserialize: str => str.split(" ") });
/**
The inverse of [`closedBy`](#common.NodeProp^closedBy). This is
attached to closing delimiters, holding an array of node names
of types of matching opening delimiters.
*/
NodeProp.openedBy = new NodeProp({ deserialize: str => str.split(" ") });
/**
Used to assign node types to groups (for example, all node
types that represent an expression could be tagged with an
`"Expression"` group).
*/
NodeProp.group = new NodeProp({ deserialize: str => str.split(" ") });
/**
Attached to nodes to indicate these should be
[displayed](https://codemirror.net/docs/ref/#language.syntaxTree)
in a bidirectional text isolate, so that direction-neutral
characters on their sides don't incorrectly get associated with
surrounding text. You'll generally want to set this for nodes
that contain arbitrary text, like strings and comments, and for
nodes that appear _inside_ arbitrary text, like HTML tags. When
not given a value, in a grammar declaration, defaults to
`"auto"`.
*/
NodeProp.isolate = new NodeProp({ deserialize: value => {
        if (value && value != "rtl" && value != "ltr" && value != "auto")
            throw new RangeError("Invalid value for isolate: " + value);
        return value || "auto";
    } });
/**
The hash of the [context](#lr.ContextTracker.constructor)
that the node was parsed in, if any. Used to limit reuse of
contextual nodes.
*/
NodeProp.contextHash = new NodeProp({ perNode: true });
/**
The distance beyond the end of the node that the tokenizer
looked ahead for any of the tokens inside the node. (The LR
parser only stores this when it is larger than 25, for
efficiency reasons.)
*/
NodeProp.lookAhead = new NodeProp({ perNode: true });
/**
This per-node prop is used to replace a given node, or part of a
node, with another tree. This is useful to include trees from
different languages in mixed-language parsers.
*/
NodeProp.mounted = new NodeProp({ perNode: true });
/**
A mounted tree, which can be [stored](#common.NodeProp^mounted) on
a tree node to indicate that parts of its content are
represented by another tree.
*/
class MountedTree {
    constructor(
    /**
    The inner tree.
    */
    tree, 
    /**
    If this is null, this tree replaces the entire node (it will
    be included in the regular iteration instead of its host
    node). If not, only the given ranges are considered to be
    covered by this tree. This is used for trees that are mixed in
    a way that isn't strictly hierarchical. Such mounted trees are
    only entered by [`resolveInner`](#common.Tree.resolveInner)
    and [`enter`](#common.SyntaxNode.enter).
    */
    overlay, 
    /**
    The parser used to create this subtree.
    */
    parser) {
        this.tree = tree;
        this.overlay = overlay;
        this.parser = parser;
    }
    /**
    @internal
    */
    static get(tree) {
        return tree && tree.props && tree.props[NodeProp.mounted.id];
    }
}
const noProps = Object.create(null);
/**
Each node in a syntax tree has a node type associated with it.
*/
class NodeType {
    /**
    @internal
    */
    constructor(
    /**
    The name of the node type. Not necessarily unique, but if the
    grammar was written properly, different node types with the
    same name within a node set should play the same semantic
    role.
    */
    name, 
    /**
    @internal
    */
    props, 
    /**
    The id of this node in its set. Corresponds to the term ids
    used in the parser.
    */
    id, 
    /**
    @internal
    */
    flags = 0) {
        this.name = name;
        this.props = props;
        this.id = id;
        this.flags = flags;
    }
    /**
    Define a node type.
    */
    static define(spec) {
        let props = spec.props && spec.props.length ? Object.create(null) : noProps;
        let flags = (spec.top ? 1 /* NodeFlag.Top */ : 0) | (spec.skipped ? 2 /* NodeFlag.Skipped */ : 0) |
            (spec.error ? 4 /* NodeFlag.Error */ : 0) | (spec.name == null ? 8 /* NodeFlag.Anonymous */ : 0);
        let type = new NodeType(spec.name || "", props, spec.id, flags);
        if (spec.props)
            for (let src of spec.props) {
                if (!Array.isArray(src))
                    src = src(type);
                if (src) {
                    if (src[0].perNode)
                        throw new RangeError("Can't store a per-node prop on a node type");
                    props[src[0].id] = src[1];
                }
            }
        return type;
    }
    /**
    Retrieves a node prop for this type. Will return `undefined` if
    the prop isn't present on this node.
    */
    prop(prop) { return this.props[prop.id]; }
    /**
    True when this is the top node of a grammar.
    */
    get isTop() { return (this.flags & 1 /* NodeFlag.Top */) > 0; }
    /**
    True when this node is produced by a skip rule.
    */
    get isSkipped() { return (this.flags & 2 /* NodeFlag.Skipped */) > 0; }
    /**
    Indicates whether this is an error node.
    */
    get isError() { return (this.flags & 4 /* NodeFlag.Error */) > 0; }
    /**
    When true, this node type doesn't correspond to a user-declared
    named node, for example because it is used to cache repetition.
    */
    get isAnonymous() { return (this.flags & 8 /* NodeFlag.Anonymous */) > 0; }
    /**
    Returns true when this node's name or one of its
    [groups](#common.NodeProp^group) matches the given string.
    */
    is(name) {
        if (typeof name == 'string') {
            if (this.name == name)
                return true;
            let group = this.prop(NodeProp.group);
            return group ? group.indexOf(name) > -1 : false;
        }
        return this.id == name;
    }
    /**
    Create a function from node types to arbitrary values by
    specifying an object whose property names are node or
    [group](#common.NodeProp^group) names. Often useful with
    [`NodeProp.add`](#common.NodeProp.add). You can put multiple
    names, separated by spaces, in a single property name to map
    multiple node names to a single value.
    */
    static match(map) {
        let direct = Object.create(null);
        for (let prop in map)
            for (let name of prop.split(" "))
                direct[name] = map[prop];
        return (node) => {
            for (let groups = node.prop(NodeProp.group), i = -1; i < (groups ? groups.length : 0); i++) {
                let found = direct[i < 0 ? node.name : groups[i]];
                if (found)
                    return found;
            }
        };
    }
}
/**
An empty dummy node type to use when no actual type is available.
*/
NodeType.none = new NodeType("", Object.create(null), 0, 8 /* NodeFlag.Anonymous */);
const CachedNode = new WeakMap(), CachedInnerNode = new WeakMap();
/**
Options that control iteration. Can be combined with the `|`
operator to enable multiple ones.
*/
var IterMode;
(function (IterMode) {
    /**
    When enabled, iteration will only visit [`Tree`](#common.Tree)
    objects, not nodes packed into
    [`TreeBuffer`](#common.TreeBuffer)s.
    */
    IterMode[IterMode["ExcludeBuffers"] = 1] = "ExcludeBuffers";
    /**
    Enable this to make iteration include anonymous nodes (such as
    the nodes that wrap repeated grammar constructs into a balanced
    tree).
    */
    IterMode[IterMode["IncludeAnonymous"] = 2] = "IncludeAnonymous";
    /**
    By default, regular [mounted](#common.NodeProp^mounted) nodes
    replace their base node in iteration. Enable this to ignore them
    instead.
    */
    IterMode[IterMode["IgnoreMounts"] = 4] = "IgnoreMounts";
    /**
    This option only applies in
    [`enter`](#common.SyntaxNode.enter)-style methods. It tells the
    library to not enter mounted overlays if one covers the given
    position.
    */
    IterMode[IterMode["IgnoreOverlays"] = 8] = "IgnoreOverlays";
})(IterMode || (IterMode = {}));
/**
A piece of syntax tree. There are two ways to approach these
trees: the way they are actually stored in memory, and the
convenient way.

Syntax trees are stored as a tree of `Tree` and `TreeBuffer`
objects. By packing detail information into `TreeBuffer` leaf
nodes, the representation is made a lot more memory-efficient.

However, when you want to actually work with tree nodes, this
representation is very awkward, so most client code will want to
use the [`TreeCursor`](#common.TreeCursor) or
[`SyntaxNode`](#common.SyntaxNode) interface instead, which provides
a view on some part of this data structure, and can be used to
move around to adjacent nodes.
*/
class Tree {
    /**
    Construct a new tree. See also [`Tree.build`](#common.Tree^build).
    */
    constructor(
    /**
    The type of the top node.
    */
    type, 
    /**
    This node's child nodes.
    */
    children, 
    /**
    The positions (offsets relative to the start of this tree) of
    the children.
    */
    positions, 
    /**
    The total length of this tree
    */
    length, 
    /**
    Per-node [node props](#common.NodeProp) to associate with this node.
    */
    props) {
        this.type = type;
        this.children = children;
        this.positions = positions;
        this.length = length;
        /**
        @internal
        */
        this.props = null;
        if (props && props.length) {
            this.props = Object.create(null);
            for (let [prop, value] of props)
                this.props[typeof prop == "number" ? prop : prop.id] = value;
        }
    }
    /**
    @internal
    */
    toString() {
        let mounted = MountedTree.get(this);
        if (mounted && !mounted.overlay)
            return mounted.tree.toString();
        let children = "";
        for (let ch of this.children) {
            let str = ch.toString();
            if (str) {
                if (children)
                    children += ",";
                children += str;
            }
        }
        return !this.type.name ? children :
            (/\W/.test(this.type.name) && !this.type.isError ? JSON.stringify(this.type.name) : this.type.name) +
                (children.length ? "(" + children + ")" : "");
    }
    /**
    Get a [tree cursor](#common.TreeCursor) positioned at the top of
    the tree. Mode can be used to [control](#common.IterMode) which
    nodes the cursor visits.
    */
    cursor(mode = 0) {
        return new TreeCursor(this.topNode, mode);
    }
    /**
    Get a [tree cursor](#common.TreeCursor) pointing into this tree
    at the given position and side (see
    [`moveTo`](#common.TreeCursor.moveTo).
    */
    cursorAt(pos, side = 0, mode = 0) {
        let scope = CachedNode.get(this) || this.topNode;
        let cursor = new TreeCursor(scope);
        cursor.moveTo(pos, side);
        CachedNode.set(this, cursor._tree);
        return cursor;
    }
    /**
    Get a [syntax node](#common.SyntaxNode) object for the top of the
    tree.
    */
    get topNode() {
        return new TreeNode(this, 0, 0, null);
    }
    /**
    Get the [syntax node](#common.SyntaxNode) at the given position.
    If `side` is -1, this will move into nodes that end at the
    position. If 1, it'll move into nodes that start at the
    position. With 0, it'll only enter nodes that cover the position
    from both sides.
    
    Note that this will not enter
    [overlays](#common.MountedTree.overlay), and you often want
    [`resolveInner`](#common.Tree.resolveInner) instead.
    */
    resolve(pos, side = 0) {
        let node = resolveNode(CachedNode.get(this) || this.topNode, pos, side, false);
        CachedNode.set(this, node);
        return node;
    }
    /**
    Like [`resolve`](#common.Tree.resolve), but will enter
    [overlaid](#common.MountedTree.overlay) nodes, producing a syntax node
    pointing into the innermost overlaid tree at the given position
    (with parent links going through all parent structure, including
    the host trees).
    */
    resolveInner(pos, side = 0) {
        let node = resolveNode(CachedInnerNode.get(this) || this.topNode, pos, side, true);
        CachedInnerNode.set(this, node);
        return node;
    }
    /**
    In some situations, it can be useful to iterate through all
    nodes around a position, including those in overlays that don't
    directly cover the position. This method gives you an iterator
    that will produce all nodes, from small to big, around the given
    position.
    */
    resolveStack(pos, side = 0) {
        return stackIterator(this, pos, side);
    }
    /**
    Iterate over the tree and its children, calling `enter` for any
    node that touches the `from`/`to` region (if given) before
    running over such a node's children, and `leave` (if given) when
    leaving the node. When `enter` returns `false`, that node will
    not have its children iterated over (or `leave` called).
    */
    iterate(spec) {
        let { enter, leave, from = 0, to = this.length } = spec;
        let mode = spec.mode || 0, anon = (mode & IterMode.IncludeAnonymous) > 0;
        for (let c = this.cursor(mode | IterMode.IncludeAnonymous);;) {
            let entered = false;
            if (c.from <= to && c.to >= from && (!anon && c.type.isAnonymous || enter(c) !== false)) {
                if (c.firstChild())
                    continue;
                entered = true;
            }
            for (;;) {
                if (entered && leave && (anon || !c.type.isAnonymous))
                    leave(c);
                if (c.nextSibling())
                    break;
                if (!c.parent())
                    return;
                entered = true;
            }
        }
    }
    /**
    Get the value of the given [node prop](#common.NodeProp) for this
    node. Works with both per-node and per-type props.
    */
    prop(prop) {
        return !prop.perNode ? this.type.prop(prop) : this.props ? this.props[prop.id] : undefined;
    }
    /**
    Returns the node's [per-node props](#common.NodeProp.perNode) in a
    format that can be passed to the [`Tree`](#common.Tree)
    constructor.
    */
    get propValues() {
        let result = [];
        if (this.props)
            for (let id in this.props)
                result.push([+id, this.props[id]]);
        return result;
    }
    /**
    Balance the direct children of this tree, producing a copy of
    which may have children grouped into subtrees with type
    [`NodeType.none`](#common.NodeType^none).
    */
    balance(config = {}) {
        return this.children.length <= 8 /* Balance.BranchFactor */ ? this :
            balanceRange(NodeType.none, this.children, this.positions, 0, this.children.length, 0, this.length, (children, positions, length) => new Tree(this.type, children, positions, length, this.propValues), config.makeTree || ((children, positions, length) => new Tree(NodeType.none, children, positions, length)));
    }
    /**
    Build a tree from a postfix-ordered buffer of node information,
    or a cursor over such a buffer.
    */
    static build(data) { return buildTree(data); }
}
/**
The empty tree
*/
Tree.empty = new Tree(NodeType.none, [], [], 0);
class FlatBufferCursor {
    constructor(buffer, index) {
        this.buffer = buffer;
        this.index = index;
    }
    get id() { return this.buffer[this.index - 4]; }
    get start() { return this.buffer[this.index - 3]; }
    get end() { return this.buffer[this.index - 2]; }
    get size() { return this.buffer[this.index - 1]; }
    get pos() { return this.index; }
    next() { this.index -= 4; }
    fork() { return new FlatBufferCursor(this.buffer, this.index); }
}
/**
Tree buffers contain (type, start, end, endIndex) quads for each
node. In such a buffer, nodes are stored in prefix order (parents
before children, with the endIndex of the parent indicating which
children belong to it).
*/
class TreeBuffer {
    /**
    Create a tree buffer.
    */
    constructor(
    /**
    The buffer's content.
    */
    buffer, 
    /**
    The total length of the group of nodes in the buffer.
    */
    length, 
    /**
    The node set used in this buffer.
    */
    set) {
        this.buffer = buffer;
        this.length = length;
        this.set = set;
    }
    /**
    @internal
    */
    get type() { return NodeType.none; }
    /**
    @internal
    */
    toString() {
        let result = [];
        for (let index = 0; index < this.buffer.length;) {
            result.push(this.childString(index));
            index = this.buffer[index + 3];
        }
        return result.join(",");
    }
    /**
    @internal
    */
    childString(index) {
        let id = this.buffer[index], endIndex = this.buffer[index + 3];
        let type = this.set.types[id], result = type.name;
        if (/\W/.test(result) && !type.isError)
            result = JSON.stringify(result);
        index += 4;
        if (endIndex == index)
            return result;
        let children = [];
        while (index < endIndex) {
            children.push(this.childString(index));
            index = this.buffer[index + 3];
        }
        return result + "(" + children.join(",") + ")";
    }
    /**
    @internal
    */
    findChild(startIndex, endIndex, dir, pos, side) {
        let { buffer } = this, pick = -1;
        for (let i = startIndex; i != endIndex; i = buffer[i + 3]) {
            if (checkSide(side, pos, buffer[i + 1], buffer[i + 2])) {
                pick = i;
                if (dir > 0)
                    break;
            }
        }
        return pick;
    }
    /**
    @internal
    */
    slice(startI, endI, from) {
        let b = this.buffer;
        let copy = new Uint16Array(endI - startI), len = 0;
        for (let i = startI, j = 0; i < endI;) {
            copy[j++] = b[i++];
            copy[j++] = b[i++] - from;
            let to = copy[j++] = b[i++] - from;
            copy[j++] = b[i++] - startI;
            len = Math.max(len, to);
        }
        return new TreeBuffer(copy, len, this.set);
    }
}
function checkSide(side, pos, from, to) {
    switch (side) {
        case -2 /* Side.Before */: return from < pos;
        case -1 /* Side.AtOrBefore */: return to >= pos && from < pos;
        case 0 /* Side.Around */: return from < pos && to > pos;
        case 1 /* Side.AtOrAfter */: return from <= pos && to > pos;
        case 2 /* Side.After */: return to > pos;
        case 4 /* Side.DontCare */: return true;
    }
}
function resolveNode(node, pos, side, overlays) {
    var _a;
    // Move up to a node that actually holds the position, if possible
    while (node.from == node.to ||
        (side < 1 ? node.from >= pos : node.from > pos) ||
        (side > -1 ? node.to <= pos : node.to < pos)) {
        let parent = !overlays && node instanceof TreeNode && node.index < 0 ? null : node.parent;
        if (!parent)
            return node;
        node = parent;
    }
    let mode = overlays ? 0 : IterMode.IgnoreOverlays;
    // Must go up out of overlays when those do not overlap with pos
    if (overlays)
        for (let scan = node, parent = scan.parent; parent; scan = parent, parent = scan.parent) {
            if (scan instanceof TreeNode && scan.index < 0 && ((_a = parent.enter(pos, side, mode)) === null || _a === void 0 ? void 0 : _a.from) != scan.from)
                node = parent;
        }
    for (;;) {
        let inner = node.enter(pos, side, mode);
        if (!inner)
            return node;
        node = inner;
    }
}
class BaseNode {
    cursor(mode = 0) { return new TreeCursor(this, mode); }
    getChild(type, before = null, after = null) {
        let r = getChildren(this, type, before, after);
        return r.length ? r[0] : null;
    }
    getChildren(type, before = null, after = null) {
        return getChildren(this, type, before, after);
    }
    resolve(pos, side = 0) {
        return resolveNode(this, pos, side, false);
    }
    resolveInner(pos, side = 0) {
        return resolveNode(this, pos, side, true);
    }
    matchContext(context) {
        return matchNodeContext(this.parent, context);
    }
    enterUnfinishedNodesBefore(pos) {
        let scan = this.childBefore(pos), node = this;
        while (scan) {
            let last = scan.lastChild;
            if (!last || last.to != scan.to)
                break;
            if (last.type.isError && last.from == last.to) {
                node = scan;
                scan = last.prevSibling;
            }
            else {
                scan = last;
            }
        }
        return node;
    }
    get node() { return this; }
    get next() { return this.parent; }
}
class TreeNode extends BaseNode {
    constructor(_tree, from, 
    // Index in parent node, set to -1 if the node is not a direct child of _parent.node (overlay)
    index, _parent) {
        super();
        this._tree = _tree;
        this.from = from;
        this.index = index;
        this._parent = _parent;
    }
    get type() { return this._tree.type; }
    get name() { return this._tree.type.name; }
    get to() { return this.from + this._tree.length; }
    nextChild(i, dir, pos, side, mode = 0) {
        for (let parent = this;;) {
            for (let { children, positions } = parent._tree, e = dir > 0 ? children.length : -1; i != e; i += dir) {
                let next = children[i], start = positions[i] + parent.from;
                if (!checkSide(side, pos, start, start + next.length))
                    continue;
                if (next instanceof TreeBuffer) {
                    if (mode & IterMode.ExcludeBuffers)
                        continue;
                    let index = next.findChild(0, next.buffer.length, dir, pos - start, side);
                    if (index > -1)
                        return new BufferNode(new BufferContext(parent, next, i, start), null, index);
                }
                else if ((mode & IterMode.IncludeAnonymous) || (!next.type.isAnonymous || hasChild(next))) {
                    let mounted;
                    if (!(mode & IterMode.IgnoreMounts) && (mounted = MountedTree.get(next)) && !mounted.overlay)
                        return new TreeNode(mounted.tree, start, i, parent);
                    let inner = new TreeNode(next, start, i, parent);
                    return (mode & IterMode.IncludeAnonymous) || !inner.type.isAnonymous ? inner
                        : inner.nextChild(dir < 0 ? next.children.length - 1 : 0, dir, pos, side);
                }
            }
            if ((mode & IterMode.IncludeAnonymous) || !parent.type.isAnonymous)
                return null;
            if (parent.index >= 0)
                i = parent.index + dir;
            else
                i = dir < 0 ? -1 : parent._parent._tree.children.length;
            parent = parent._parent;
            if (!parent)
                return null;
        }
    }
    get firstChild() { return this.nextChild(0, 1, 0, 4 /* Side.DontCare */); }
    get lastChild() { return this.nextChild(this._tree.children.length - 1, -1, 0, 4 /* Side.DontCare */); }
    childAfter(pos) { return this.nextChild(0, 1, pos, 2 /* Side.After */); }
    childBefore(pos) { return this.nextChild(this._tree.children.length - 1, -1, pos, -2 /* Side.Before */); }
    enter(pos, side, mode = 0) {
        let mounted;
        if (!(mode & IterMode.IgnoreOverlays) && (mounted = MountedTree.get(this._tree)) && mounted.overlay) {
            let rPos = pos - this.from;
            for (let { from, to } of mounted.overlay) {
                if ((side > 0 ? from <= rPos : from < rPos) &&
                    (side < 0 ? to >= rPos : to > rPos))
                    return new TreeNode(mounted.tree, mounted.overlay[0].from + this.from, -1, this);
            }
        }
        return this.nextChild(0, 1, pos, side, mode);
    }
    nextSignificantParent() {
        let val = this;
        while (val.type.isAnonymous && val._parent)
            val = val._parent;
        return val;
    }
    get parent() {
        return this._parent ? this._parent.nextSignificantParent() : null;
    }
    get nextSibling() {
        return this._parent && this.index >= 0 ? this._parent.nextChild(this.index + 1, 1, 0, 4 /* Side.DontCare */) : null;
    }
    get prevSibling() {
        return this._parent && this.index >= 0 ? this._parent.nextChild(this.index - 1, -1, 0, 4 /* Side.DontCare */) : null;
    }
    get tree() { return this._tree; }
    toTree() { return this._tree; }
    /**
    @internal
    */
    toString() { return this._tree.toString(); }
}
function getChildren(node, type, before, after) {
    let cur = node.cursor(), result = [];
    if (!cur.firstChild())
        return result;
    if (before != null)
        for (let found = false; !found;) {
            found = cur.type.is(before);
            if (!cur.nextSibling())
                return result;
        }
    for (;;) {
        if (after != null && cur.type.is(after))
            return result;
        if (cur.type.is(type))
            result.push(cur.node);
        if (!cur.nextSibling())
            return after == null ? result : [];
    }
}
function matchNodeContext(node, context, i = context.length - 1) {
    for (let p = node; i >= 0; p = p.parent) {
        if (!p)
            return false;
        if (!p.type.isAnonymous) {
            if (context[i] && context[i] != p.name)
                return false;
            i--;
        }
    }
    return true;
}
class BufferContext {
    constructor(parent, buffer, index, start) {
        this.parent = parent;
        this.buffer = buffer;
        this.index = index;
        this.start = start;
    }
}
class BufferNode extends BaseNode {
    get name() { return this.type.name; }
    get from() { return this.context.start + this.context.buffer.buffer[this.index + 1]; }
    get to() { return this.context.start + this.context.buffer.buffer[this.index + 2]; }
    constructor(context, _parent, index) {
        super();
        this.context = context;
        this._parent = _parent;
        this.index = index;
        this.type = context.buffer.set.types[context.buffer.buffer[index]];
    }
    child(dir, pos, side) {
        let { buffer } = this.context;
        let index = buffer.findChild(this.index + 4, buffer.buffer[this.index + 3], dir, pos - this.context.start, side);
        return index < 0 ? null : new BufferNode(this.context, this, index);
    }
    get firstChild() { return this.child(1, 0, 4 /* Side.DontCare */); }
    get lastChild() { return this.child(-1, 0, 4 /* Side.DontCare */); }
    childAfter(pos) { return this.child(1, pos, 2 /* Side.After */); }
    childBefore(pos) { return this.child(-1, pos, -2 /* Side.Before */); }
    enter(pos, side, mode = 0) {
        if (mode & IterMode.ExcludeBuffers)
            return null;
        let { buffer } = this.context;
        let index = buffer.findChild(this.index + 4, buffer.buffer[this.index + 3], side > 0 ? 1 : -1, pos - this.context.start, side);
        return index < 0 ? null : new BufferNode(this.context, this, index);
    }
    get parent() {
        return this._parent || this.context.parent.nextSignificantParent();
    }
    externalSibling(dir) {
        return this._parent ? null : this.context.parent.nextChild(this.context.index + dir, dir, 0, 4 /* Side.DontCare */);
    }
    get nextSibling() {
        let { buffer } = this.context;
        let after = buffer.buffer[this.index + 3];
        if (after < (this._parent ? buffer.buffer[this._parent.index + 3] : buffer.buffer.length))
            return new BufferNode(this.context, this._parent, after);
        return this.externalSibling(1);
    }
    get prevSibling() {
        let { buffer } = this.context;
        let parentStart = this._parent ? this._parent.index + 4 : 0;
        if (this.index == parentStart)
            return this.externalSibling(-1);
        return new BufferNode(this.context, this._parent, buffer.findChild(parentStart, this.index, -1, 0, 4 /* Side.DontCare */));
    }
    get tree() { return null; }
    toTree() {
        let children = [], positions = [];
        let { buffer } = this.context;
        let startI = this.index + 4, endI = buffer.buffer[this.index + 3];
        if (endI > startI) {
            let from = buffer.buffer[this.index + 1];
            children.push(buffer.slice(startI, endI, from));
            positions.push(0);
        }
        return new Tree(this.type, children, positions, this.to - this.from);
    }
    /**
    @internal
    */
    toString() { return this.context.buffer.childString(this.index); }
}
function iterStack(heads) {
    if (!heads.length)
        return null;
    let pick = 0, picked = heads[0];
    for (let i = 1; i < heads.length; i++) {
        let node = heads[i];
        if (node.from > picked.from || node.to < picked.to) {
            picked = node;
            pick = i;
        }
    }
    let next = picked instanceof TreeNode && picked.index < 0 ? null : picked.parent;
    let newHeads = heads.slice();
    if (next)
        newHeads[pick] = next;
    else
        newHeads.splice(pick, 1);
    return new StackIterator(newHeads, picked);
}
class StackIterator {
    constructor(heads, node) {
        this.heads = heads;
        this.node = node;
    }
    get next() { return iterStack(this.heads); }
}
function stackIterator(tree, pos, side) {
    let inner = tree.resolveInner(pos, side), layers = null;
    for (let scan = inner instanceof TreeNode ? inner : inner.context.parent; scan; scan = scan.parent) {
        if (scan.index < 0) { // This is an overlay root
            let parent = scan.parent;
            (layers || (layers = [inner])).push(parent.resolve(pos, side));
            scan = parent;
        }
        else {
            let mount = MountedTree.get(scan.tree);
            // Relevant overlay branching off
            if (mount && mount.overlay && mount.overlay[0].from <= pos && mount.overlay[mount.overlay.length - 1].to >= pos) {
                let root = new TreeNode(mount.tree, mount.overlay[0].from + scan.from, -1, scan);
                (layers || (layers = [inner])).push(resolveNode(root, pos, side, false));
            }
        }
    }
    return layers ? iterStack(layers) : inner;
}
/**
A tree cursor object focuses on a given node in a syntax tree, and
allows you to move to adjacent nodes.
*/
class TreeCursor {
    /**
    Shorthand for `.type.name`.
    */
    get name() { return this.type.name; }
    /**
    @internal
    */
    constructor(node, 
    /**
    @internal
    */
    mode = 0) {
        this.mode = mode;
        /**
        @internal
        */
        this.buffer = null;
        this.stack = [];
        /**
        @internal
        */
        this.index = 0;
        this.bufferNode = null;
        if (node instanceof TreeNode) {
            this.yieldNode(node);
        }
        else {
            this._tree = node.context.parent;
            this.buffer = node.context;
            for (let n = node._parent; n; n = n._parent)
                this.stack.unshift(n.index);
            this.bufferNode = node;
            this.yieldBuf(node.index);
        }
    }
    yieldNode(node) {
        if (!node)
            return false;
        this._tree = node;
        this.type = node.type;
        this.from = node.from;
        this.to = node.to;
        return true;
    }
    yieldBuf(index, type) {
        this.index = index;
        let { start, buffer } = this.buffer;
        this.type = type || buffer.set.types[buffer.buffer[index]];
        this.from = start + buffer.buffer[index + 1];
        this.to = start + buffer.buffer[index + 2];
        return true;
    }
    /**
    @internal
    */
    yield(node) {
        if (!node)
            return false;
        if (node instanceof TreeNode) {
            this.buffer = null;
            return this.yieldNode(node);
        }
        this.buffer = node.context;
        return this.yieldBuf(node.index, node.type);
    }
    /**
    @internal
    */
    toString() {
        return this.buffer ? this.buffer.buffer.childString(this.index) : this._tree.toString();
    }
    /**
    @internal
    */
    enterChild(dir, pos, side) {
        if (!this.buffer)
            return this.yield(this._tree.nextChild(dir < 0 ? this._tree._tree.children.length - 1 : 0, dir, pos, side, this.mode));
        let { buffer } = this.buffer;
        let index = buffer.findChild(this.index + 4, buffer.buffer[this.index + 3], dir, pos - this.buffer.start, side);
        if (index < 0)
            return false;
        this.stack.push(this.index);
        return this.yieldBuf(index);
    }
    /**
    Move the cursor to this node's first child. When this returns
    false, the node has no child, and the cursor has not been moved.
    */
    firstChild() { return this.enterChild(1, 0, 4 /* Side.DontCare */); }
    /**
    Move the cursor to this node's last child.
    */
    lastChild() { return this.enterChild(-1, 0, 4 /* Side.DontCare */); }
    /**
    Move the cursor to the first child that ends after `pos`.
    */
    childAfter(pos) { return this.enterChild(1, pos, 2 /* Side.After */); }
    /**
    Move to the last child that starts before `pos`.
    */
    childBefore(pos) { return this.enterChild(-1, pos, -2 /* Side.Before */); }
    /**
    Move the cursor to the child around `pos`. If side is -1 the
    child may end at that position, when 1 it may start there. This
    will also enter [overlaid](#common.MountedTree.overlay)
    [mounted](#common.NodeProp^mounted) trees unless `overlays` is
    set to false.
    */
    enter(pos, side, mode = this.mode) {
        if (!this.buffer)
            return this.yield(this._tree.enter(pos, side, mode));
        return mode & IterMode.ExcludeBuffers ? false : this.enterChild(1, pos, side);
    }
    /**
    Move to the node's parent node, if this isn't the top node.
    */
    parent() {
        if (!this.buffer)
            return this.yieldNode((this.mode & IterMode.IncludeAnonymous) ? this._tree._parent : this._tree.parent);
        if (this.stack.length)
            return this.yieldBuf(this.stack.pop());
        let parent = (this.mode & IterMode.IncludeAnonymous) ? this.buffer.parent : this.buffer.parent.nextSignificantParent();
        this.buffer = null;
        return this.yieldNode(parent);
    }
    /**
    @internal
    */
    sibling(dir) {
        if (!this.buffer)
            return !this._tree._parent ? false
                : this.yield(this._tree.index < 0 ? null
                    : this._tree._parent.nextChild(this._tree.index + dir, dir, 0, 4 /* Side.DontCare */, this.mode));
        let { buffer } = this.buffer, d = this.stack.length - 1;
        if (dir < 0) {
            let parentStart = d < 0 ? 0 : this.stack[d] + 4;
            if (this.index != parentStart)
                return this.yieldBuf(buffer.findChild(parentStart, this.index, -1, 0, 4 /* Side.DontCare */));
        }
        else {
            let after = buffer.buffer[this.index + 3];
            if (after < (d < 0 ? buffer.buffer.length : buffer.buffer[this.stack[d] + 3]))
                return this.yieldBuf(after);
        }
        return d < 0 ? this.yield(this.buffer.parent.nextChild(this.buffer.index + dir, dir, 0, 4 /* Side.DontCare */, this.mode)) : false;
    }
    /**
    Move to this node's next sibling, if any.
    */
    nextSibling() { return this.sibling(1); }
    /**
    Move to this node's previous sibling, if any.
    */
    prevSibling() { return this.sibling(-1); }
    atLastNode(dir) {
        let index, parent, { buffer } = this;
        if (buffer) {
            if (dir > 0) {
                if (this.index < buffer.buffer.buffer.length)
                    return false;
            }
            else {
                for (let i = 0; i < this.index; i++)
                    if (buffer.buffer.buffer[i + 3] < this.index)
                        return false;
            }
            ({ index, parent } = buffer);
        }
        else {
            ({ index, _parent: parent } = this._tree);
        }
        for (; parent; { index, _parent: parent } = parent) {
            if (index > -1)
                for (let i = index + dir, e = dir < 0 ? -1 : parent._tree.children.length; i != e; i += dir) {
                    let child = parent._tree.children[i];
                    if ((this.mode & IterMode.IncludeAnonymous) ||
                        child instanceof TreeBuffer ||
                        !child.type.isAnonymous ||
                        hasChild(child))
                        return false;
                }
        }
        return true;
    }
    move(dir, enter) {
        if (enter && this.enterChild(dir, 0, 4 /* Side.DontCare */))
            return true;
        for (;;) {
            if (this.sibling(dir))
                return true;
            if (this.atLastNode(dir) || !this.parent())
                return false;
        }
    }
    /**
    Move to the next node in a
    [pre-order](https://en.wikipedia.org/wiki/Tree_traversal#Pre-order,_NLR)
    traversal, going from a node to its first child or, if the
    current node is empty or `enter` is false, its next sibling or
    the next sibling of the first parent node that has one.
    */
    next(enter = true) { return this.move(1, enter); }
    /**
    Move to the next node in a last-to-first pre-order traversal. A
    node is followed by its last child or, if it has none, its
    previous sibling or the previous sibling of the first parent
    node that has one.
    */
    prev(enter = true) { return this.move(-1, enter); }
    /**
    Move the cursor to the innermost node that covers `pos`. If
    `side` is -1, it will enter nodes that end at `pos`. If it is 1,
    it will enter nodes that start at `pos`.
    */
    moveTo(pos, side = 0) {
        // Move up to a node that actually holds the position, if possible
        while (this.from == this.to ||
            (side < 1 ? this.from >= pos : this.from > pos) ||
            (side > -1 ? this.to <= pos : this.to < pos))
            if (!this.parent())
                break;
        // Then scan down into child nodes as far as possible
        while (this.enterChild(1, pos, side)) { }
        return this;
    }
    /**
    Get a [syntax node](#common.SyntaxNode) at the cursor's current
    position.
    */
    get node() {
        if (!this.buffer)
            return this._tree;
        let cache = this.bufferNode, result = null, depth = 0;
        if (cache && cache.context == this.buffer) {
            scan: for (let index = this.index, d = this.stack.length; d >= 0;) {
                for (let c = cache; c; c = c._parent)
                    if (c.index == index) {
                        if (index == this.index)
                            return c;
                        result = c;
                        depth = d + 1;
                        break scan;
                    }
                index = this.stack[--d];
            }
        }
        for (let i = depth; i < this.stack.length; i++)
            result = new BufferNode(this.buffer, result, this.stack[i]);
        return this.bufferNode = new BufferNode(this.buffer, result, this.index);
    }
    /**
    Get the [tree](#common.Tree) that represents the current node, if
    any. Will return null when the node is in a [tree
    buffer](#common.TreeBuffer).
    */
    get tree() {
        return this.buffer ? null : this._tree._tree;
    }
    /**
    Iterate over the current node and all its descendants, calling
    `enter` when entering a node and `leave`, if given, when leaving
    one. When `enter` returns `false`, any children of that node are
    skipped, and `leave` isn't called for it.
    */
    iterate(enter, leave) {
        for (let depth = 0;;) {
            let mustLeave = false;
            if (this.type.isAnonymous || enter(this) !== false) {
                if (this.firstChild()) {
                    depth++;
                    continue;
                }
                if (!this.type.isAnonymous)
                    mustLeave = true;
            }
            for (;;) {
                if (mustLeave && leave)
                    leave(this);
                mustLeave = this.type.isAnonymous;
                if (!depth)
                    return;
                if (this.nextSibling())
                    break;
                this.parent();
                depth--;
                mustLeave = true;
            }
        }
    }
    /**
    Test whether the current node matches a given context—a sequence
    of direct parent node names. Empty strings in the context array
    are treated as wildcards.
    */
    matchContext(context) {
        if (!this.buffer)
            return matchNodeContext(this.node.parent, context);
        let { buffer } = this.buffer, { types } = buffer.set;
        for (let i = context.length - 1, d = this.stack.length - 1; i >= 0; d--) {
            if (d < 0)
                return matchNodeContext(this._tree, context, i);
            let type = types[buffer.buffer[this.stack[d]]];
            if (!type.isAnonymous) {
                if (context[i] && context[i] != type.name)
                    return false;
                i--;
            }
        }
        return true;
    }
}
function hasChild(tree) {
    return tree.children.some(ch => ch instanceof TreeBuffer || !ch.type.isAnonymous || hasChild(ch));
}
function buildTree(data) {
    var _a;
    let { buffer, nodeSet, maxBufferLength = DefaultBufferLength, reused = [], minRepeatType = nodeSet.types.length } = data;
    let cursor = Array.isArray(buffer) ? new FlatBufferCursor(buffer, buffer.length) : buffer;
    let types = nodeSet.types;
    let contextHash = 0, lookAhead = 0;
    function takeNode(parentStart, minPos, children, positions, inRepeat, depth) {
        let { id, start, end, size } = cursor;
        let lookAheadAtStart = lookAhead, contextAtStart = contextHash;
        while (size < 0) {
            cursor.next();
            if (size == -1 /* SpecialRecord.Reuse */) {
                let node = reused[id];
                children.push(node);
                positions.push(start - parentStart);
                return;
            }
            else if (size == -3 /* SpecialRecord.ContextChange */) { // Context change
                contextHash = id;
                return;
            }
            else if (size == -4 /* SpecialRecord.LookAhead */) {
                lookAhead = id;
                return;
            }
            else {
                throw new RangeError(`Unrecognized record size: ${size}`);
            }
        }
        let type = types[id], node, buffer;
        let startPos = start - parentStart;
        if (end - start <= maxBufferLength && (buffer = findBufferSize(cursor.pos - minPos, inRepeat))) {
            // Small enough for a buffer, and no reused nodes inside
            let data = new Uint16Array(buffer.size - buffer.skip);
            let endPos = cursor.pos - buffer.size, index = data.length;
            while (cursor.pos > endPos)
                index = copyToBuffer(buffer.start, data, index);
            node = new TreeBuffer(data, end - buffer.start, nodeSet);
            startPos = buffer.start - parentStart;
        }
        else { // Make it a node
            let endPos = cursor.pos - size;
            cursor.next();
            let localChildren = [], localPositions = [];
            let localInRepeat = id >= minRepeatType ? id : -1;
            let lastGroup = 0, lastEnd = end;
            while (cursor.pos > endPos) {
                if (localInRepeat >= 0 && cursor.id == localInRepeat && cursor.size >= 0) {
                    if (cursor.end <= lastEnd - maxBufferLength) {
                        makeRepeatLeaf(localChildren, localPositions, start, lastGroup, cursor.end, lastEnd, localInRepeat, lookAheadAtStart, contextAtStart);
                        lastGroup = localChildren.length;
                        lastEnd = cursor.end;
                    }
                    cursor.next();
                }
                else if (depth > 2500 /* CutOff.Depth */) {
                    takeFlatNode(start, endPos, localChildren, localPositions);
                }
                else {
                    takeNode(start, endPos, localChildren, localPositions, localInRepeat, depth + 1);
                }
            }
            if (localInRepeat >= 0 && lastGroup > 0 && lastGroup < localChildren.length)
                makeRepeatLeaf(localChildren, localPositions, start, lastGroup, start, lastEnd, localInRepeat, lookAheadAtStart, contextAtStart);
            localChildren.reverse();
            localPositions.reverse();
            if (localInRepeat > -1 && lastGroup > 0) {
                let make = makeBalanced(type, contextAtStart);
                node = balanceRange(type, localChildren, localPositions, 0, localChildren.length, 0, end - start, make, make);
            }
            else {
                node = makeTree(type, localChildren, localPositions, end - start, lookAheadAtStart - end, contextAtStart);
            }
        }
        children.push(node);
        positions.push(startPos);
    }
    function takeFlatNode(parentStart, minPos, children, positions) {
        let nodes = []; // Temporary, inverted array of leaf nodes found, with absolute positions
        let nodeCount = 0, stopAt = -1;
        while (cursor.pos > minPos) {
            let { id, start, end, size } = cursor;
            if (size > 4) { // Not a leaf
                cursor.next();
            }
            else if (stopAt > -1 && start < stopAt) {
                break;
            }
            else {
                if (stopAt < 0)
                    stopAt = end - maxBufferLength;
                nodes.push(id, start, end);
                nodeCount++;
                cursor.next();
            }
        }
        if (nodeCount) {
            let buffer = new Uint16Array(nodeCount * 4);
            let start = nodes[nodes.length - 2];
            for (let i = nodes.length - 3, j = 0; i >= 0; i -= 3) {
                buffer[j++] = nodes[i];
                buffer[j++] = nodes[i + 1] - start;
                buffer[j++] = nodes[i + 2] - start;
                buffer[j++] = j;
            }
            children.push(new TreeBuffer(buffer, nodes[2] - start, nodeSet));
            positions.push(start - parentStart);
        }
    }
    function makeBalanced(type, contextHash) {
        return (children, positions, length) => {
            let lookAhead = 0, lastI = children.length - 1, last, lookAheadProp;
            if (lastI >= 0 && (last = children[lastI]) instanceof Tree) {
                if (!lastI && last.type == type && last.length == length)
                    return last;
                if (lookAheadProp = last.prop(NodeProp.lookAhead))
                    lookAhead = positions[lastI] + last.length + lookAheadProp;
            }
            return makeTree(type, children, positions, length, lookAhead, contextHash);
        };
    }
    function makeRepeatLeaf(children, positions, base, i, from, to, type, lookAhead, contextHash) {
        let localChildren = [], localPositions = [];
        while (children.length > i) {
            localChildren.push(children.pop());
            localPositions.push(positions.pop() + base - from);
        }
        children.push(makeTree(nodeSet.types[type], localChildren, localPositions, to - from, lookAhead - to, contextHash));
        positions.push(from - base);
    }
    function makeTree(type, children, positions, length, lookAhead, contextHash, props) {
        if (contextHash) {
            let pair = [NodeProp.contextHash, contextHash];
            props = props ? [pair].concat(props) : [pair];
        }
        if (lookAhead > 25) {
            let pair = [NodeProp.lookAhead, lookAhead];
            props = props ? [pair].concat(props) : [pair];
        }
        return new Tree(type, children, positions, length, props);
    }
    function findBufferSize(maxSize, inRepeat) {
        // Scan through the buffer to find previous siblings that fit
        // together in a TreeBuffer, and don't contain any reused nodes
        // (which can't be stored in a buffer).
        // If `inRepeat` is > -1, ignore node boundaries of that type for
        // nesting, but make sure the end falls either at the start
        // (`maxSize`) or before such a node.
        let fork = cursor.fork();
        let size = 0, start = 0, skip = 0, minStart = fork.end - maxBufferLength;
        let result = { size: 0, start: 0, skip: 0 };
        scan: for (let minPos = fork.pos - maxSize; fork.pos > minPos;) {
            let nodeSize = fork.size;
            // Pretend nested repeat nodes of the same type don't exist
            if (fork.id == inRepeat && nodeSize >= 0) {
                // Except that we store the current state as a valid return
                // value.
                result.size = size;
                result.start = start;
                result.skip = skip;
                skip += 4;
                size += 4;
                fork.next();
                continue;
            }
            let startPos = fork.pos - nodeSize;
            if (nodeSize < 0 || startPos < minPos || fork.start < minStart)
                break;
            let localSkipped = fork.id >= minRepeatType ? 4 : 0;
            let nodeStart = fork.start;
            fork.next();
            while (fork.pos > startPos) {
                if (fork.size < 0) {
                    if (fork.size == -3 /* SpecialRecord.ContextChange */)
                        localSkipped += 4;
                    else
                        break scan;
                }
                else if (fork.id >= minRepeatType) {
                    localSkipped += 4;
                }
                fork.next();
            }
            start = nodeStart;
            size += nodeSize;
            skip += localSkipped;
        }
        if (inRepeat < 0 || size == maxSize) {
            result.size = size;
            result.start = start;
            result.skip = skip;
        }
        return result.size > 4 ? result : undefined;
    }
    function copyToBuffer(bufferStart, buffer, index) {
        let { id, start, end, size } = cursor;
        cursor.next();
        if (size >= 0 && id < minRepeatType) {
            let startIndex = index;
            if (size > 4) {
                let endPos = cursor.pos - (size - 4);
                while (cursor.pos > endPos)
                    index = copyToBuffer(bufferStart, buffer, index);
            }
            buffer[--index] = startIndex;
            buffer[--index] = end - bufferStart;
            buffer[--index] = start - bufferStart;
            buffer[--index] = id;
        }
        else if (size == -3 /* SpecialRecord.ContextChange */) {
            contextHash = id;
        }
        else if (size == -4 /* SpecialRecord.LookAhead */) {
            lookAhead = id;
        }
        return index;
    }
    let children = [], positions = [];
    while (cursor.pos > 0)
        takeNode(data.start || 0, data.bufferStart || 0, children, positions, -1, 0);
    let length = (_a = data.length) !== null && _a !== void 0 ? _a : (children.length ? positions[0] + children[0].length : 0);
    return new Tree(types[data.topID], children.reverse(), positions.reverse(), length);
}
const nodeSizeCache = new WeakMap;
function nodeSize(balanceType, node) {
    if (!balanceType.isAnonymous || node instanceof TreeBuffer || node.type != balanceType)
        return 1;
    let size = nodeSizeCache.get(node);
    if (size == null) {
        size = 1;
        for (let child of node.children) {
            if (child.type != balanceType || !(child instanceof Tree)) {
                size = 1;
                break;
            }
            size += nodeSize(balanceType, child);
        }
        nodeSizeCache.set(node, size);
    }
    return size;
}
function balanceRange(
// The type the balanced tree's inner nodes.
balanceType, 
// The direct children and their positions
children, positions, 
// The index range in children/positions to use
from, to, 
// The start position of the nodes, relative to their parent.
start, 
// Length of the outer node
length, 
// Function to build the top node of the balanced tree
mkTop, 
// Function to build internal nodes for the balanced tree
mkTree) {
    let total = 0;
    for (let i = from; i < to; i++)
        total += nodeSize(balanceType, children[i]);
    let maxChild = Math.ceil((total * 1.5) / 8 /* Balance.BranchFactor */);
    let localChildren = [], localPositions = [];
    function divide(children, positions, from, to, offset) {
        for (let i = from; i < to;) {
            let groupFrom = i, groupStart = positions[i], groupSize = nodeSize(balanceType, children[i]);
            i++;
            for (; i < to; i++) {
                let nextSize = nodeSize(balanceType, children[i]);
                if (groupSize + nextSize >= maxChild)
                    break;
                groupSize += nextSize;
            }
            if (i == groupFrom + 1) {
                if (groupSize > maxChild) {
                    let only = children[groupFrom]; // Only trees can have a size > 1
                    divide(only.children, only.positions, 0, only.children.length, positions[groupFrom] + offset);
                    continue;
                }
                localChildren.push(children[groupFrom]);
            }
            else {
                let length = positions[i - 1] + children[i - 1].length - groupStart;
                localChildren.push(balanceRange(balanceType, children, positions, groupFrom, i, groupStart, length, null, mkTree));
            }
            localPositions.push(groupStart + offset - start);
        }
    }
    divide(children, positions, from, to, 0);
    return (mkTop || mkTree)(localChildren, localPositions, length);
}
new NodeProp({ perNode: true });

let nextTagID = 0;
/**
Highlighting tags are markers that denote a highlighting category.
They are [associated](#highlight.styleTags) with parts of a syntax
tree by a language mode, and then mapped to an actual CSS style by
a [highlighter](#highlight.Highlighter).

Because syntax tree node types and highlight styles have to be
able to talk the same language, CodeMirror uses a mostly _closed_
[vocabulary](#highlight.tags) of syntax tags (as opposed to
traditional open string-based systems, which make it hard for
highlighting themes to cover all the tokens produced by the
various languages).

It _is_ possible to [define](#highlight.Tag^define) your own
highlighting tags for system-internal use (where you control both
the language package and the highlighter), but such tags will not
be picked up by regular highlighters (though you can derive them
from standard tags to allow highlighters to fall back to those).
*/
class Tag {
    /**
    @internal
    */
    constructor(
    /**
    The optional name of the base tag @internal
    */
    name, 
    /**
    The set of this tag and all its parent tags, starting with
    this one itself and sorted in order of decreasing specificity.
    */
    set, 
    /**
    The base unmodified tag that this one is based on, if it's
    modified @internal
    */
    base, 
    /**
    The modifiers applied to this.base @internal
    */
    modified) {
        this.name = name;
        this.set = set;
        this.base = base;
        this.modified = modified;
        /**
        @internal
        */
        this.id = nextTagID++;
    }
    toString() {
        let { name } = this;
        for (let mod of this.modified)
            if (mod.name)
                name = `${mod.name}(${name})`;
        return name;
    }
    static define(nameOrParent, parent) {
        let name = typeof nameOrParent == "string" ? nameOrParent : "?";
        if (nameOrParent instanceof Tag)
            parent = nameOrParent;
        if (parent === null || parent === void 0 ? void 0 : parent.base)
            throw new Error("Can not derive from a modified tag");
        let tag = new Tag(name, [], null, []);
        tag.set.push(tag);
        if (parent)
            for (let t of parent.set)
                tag.set.push(t);
        return tag;
    }
    /**
    Define a tag _modifier_, which is a function that, given a tag,
    will return a tag that is a subtag of the original. Applying the
    same modifier to a twice tag will return the same value (`m1(t1)
    == m1(t1)`) and applying multiple modifiers will, regardless or
    order, produce the same tag (`m1(m2(t1)) == m2(m1(t1))`).
    
    When multiple modifiers are applied to a given base tag, each
    smaller set of modifiers is registered as a parent, so that for
    example `m1(m2(m3(t1)))` is a subtype of `m1(m2(t1))`,
    `m1(m3(t1)`, and so on.
    */
    static defineModifier(name) {
        let mod = new Modifier(name);
        return (tag) => {
            if (tag.modified.indexOf(mod) > -1)
                return tag;
            return Modifier.get(tag.base || tag, tag.modified.concat(mod).sort((a, b) => a.id - b.id));
        };
    }
}
let nextModifierID = 0;
class Modifier {
    constructor(name) {
        this.name = name;
        this.instances = [];
        this.id = nextModifierID++;
    }
    static get(base, mods) {
        if (!mods.length)
            return base;
        let exists = mods[0].instances.find(t => t.base == base && sameArray(mods, t.modified));
        if (exists)
            return exists;
        let set = [], tag = new Tag(base.name, set, base, mods);
        for (let m of mods)
            m.instances.push(tag);
        let configs = powerSet(mods);
        for (let parent of base.set)
            if (!parent.modified.length)
                for (let config of configs)
                    set.push(Modifier.get(parent, config));
        return tag;
    }
}
function sameArray(a, b) {
    return a.length == b.length && a.every((x, i) => x == b[i]);
}
function powerSet(array) {
    let sets = [[]];
    for (let i = 0; i < array.length; i++) {
        for (let j = 0, e = sets.length; j < e; j++) {
            sets.push(sets[j].concat(array[i]));
        }
    }
    return sets.sort((a, b) => b.length - a.length);
}
const ruleNodeProp = new NodeProp();
class Rule {
    constructor(tags, mode, context, next) {
        this.tags = tags;
        this.mode = mode;
        this.context = context;
        this.next = next;
    }
    get opaque() { return this.mode == 0 /* Mode.Opaque */; }
    get inherit() { return this.mode == 1 /* Mode.Inherit */; }
    sort(other) {
        if (!other || other.depth < this.depth) {
            this.next = other;
            return this;
        }
        other.next = this.sort(other.next);
        return other;
    }
    get depth() { return this.context ? this.context.length : 0; }
}
Rule.empty = new Rule([], 2 /* Mode.Normal */, null);
/**
Define a [highlighter](#highlight.Highlighter) from an array of
tag/class pairs. Classes associated with more specific tags will
take precedence.
*/
function tagHighlighter(tags, options) {
    let map = Object.create(null);
    for (let style of tags) {
        if (!Array.isArray(style.tag))
            map[style.tag.id] = style.class;
        else
            for (let tag of style.tag)
                map[tag.id] = style.class;
    }
    let { scope, all = null } = options || {};
    return {
        style: (tags) => {
            let cls = all;
            for (let tag of tags) {
                for (let sub of tag.set) {
                    let tagClass = map[sub.id];
                    if (tagClass) {
                        cls = cls ? cls + " " + tagClass : tagClass;
                        break;
                    }
                }
            }
            return cls;
        },
        scope
    };
}
function highlightTags(highlighters, tags) {
    let result = null;
    for (let highlighter of highlighters) {
        let value = highlighter.style(tags);
        if (value)
            result = result ? result + " " + value : value;
    }
    return result;
}
/**
Highlight the given [tree](#common.Tree) with the given
[highlighter](#highlight.Highlighter). Often, the higher-level
[`highlightCode`](#highlight.highlightCode) function is easier to
use.
*/
function highlightTree(tree, highlighter, 
/**
Assign styling to a region of the text. Will be called, in order
of position, for any ranges where more than zero classes apply.
`classes` is a space separated string of CSS classes.
*/
putStyle, 
/**
The start of the range to highlight.
*/
from = 0, 
/**
The end of the range.
*/
to = tree.length) {
    let builder = new HighlightBuilder(from, Array.isArray(highlighter) ? highlighter : [highlighter], putStyle);
    builder.highlightRange(tree.cursor(), from, to, "", builder.highlighters);
    builder.flush(to);
}
class HighlightBuilder {
    constructor(at, highlighters, span) {
        this.at = at;
        this.highlighters = highlighters;
        this.span = span;
        this.class = "";
    }
    startSpan(at, cls) {
        if (cls != this.class) {
            this.flush(at);
            if (at > this.at)
                this.at = at;
            this.class = cls;
        }
    }
    flush(to) {
        if (to > this.at && this.class)
            this.span(this.at, to, this.class);
    }
    highlightRange(cursor, from, to, inheritedClass, highlighters) {
        let { type, from: start, to: end } = cursor;
        if (start >= to || end <= from)
            return;
        if (type.isTop)
            highlighters = this.highlighters.filter(h => !h.scope || h.scope(type));
        let cls = inheritedClass;
        let rule = getStyleTags(cursor) || Rule.empty;
        let tagCls = highlightTags(highlighters, rule.tags);
        if (tagCls) {
            if (cls)
                cls += " ";
            cls += tagCls;
            if (rule.mode == 1 /* Mode.Inherit */)
                inheritedClass += (inheritedClass ? " " : "") + tagCls;
        }
        this.startSpan(Math.max(from, start), cls);
        if (rule.opaque)
            return;
        let mounted = cursor.tree && cursor.tree.prop(NodeProp.mounted);
        if (mounted && mounted.overlay) {
            let inner = cursor.node.enter(mounted.overlay[0].from + start, 1);
            let innerHighlighters = this.highlighters.filter(h => !h.scope || h.scope(mounted.tree.type));
            let hasChild = cursor.firstChild();
            for (let i = 0, pos = start;; i++) {
                let next = i < mounted.overlay.length ? mounted.overlay[i] : null;
                let nextPos = next ? next.from + start : end;
                let rangeFrom = Math.max(from, pos), rangeTo = Math.min(to, nextPos);
                if (rangeFrom < rangeTo && hasChild) {
                    while (cursor.from < rangeTo) {
                        this.highlightRange(cursor, rangeFrom, rangeTo, inheritedClass, highlighters);
                        this.startSpan(Math.min(rangeTo, cursor.to), cls);
                        if (cursor.to >= nextPos || !cursor.nextSibling())
                            break;
                    }
                }
                if (!next || nextPos > to)
                    break;
                pos = next.to + start;
                if (pos > from) {
                    this.highlightRange(inner.cursor(), Math.max(from, next.from + start), Math.min(to, pos), "", innerHighlighters);
                    this.startSpan(Math.min(to, pos), cls);
                }
            }
            if (hasChild)
                cursor.parent();
        }
        else if (cursor.firstChild()) {
            if (mounted)
                inheritedClass = "";
            do {
                if (cursor.to <= from)
                    continue;
                if (cursor.from >= to)
                    break;
                this.highlightRange(cursor, from, to, inheritedClass, highlighters);
                this.startSpan(Math.min(to, cursor.to), cls);
            } while (cursor.nextSibling());
            cursor.parent();
        }
    }
}
/**
Match a syntax node's [highlight rules](#highlight.styleTags). If
there's a match, return its set of tags, and whether it is
opaque (uses a `!`) or applies to all child nodes (`/...`).
*/
function getStyleTags(node) {
    let rule = node.type.prop(ruleNodeProp);
    while (rule && rule.context && !node.matchContext(rule.context))
        rule = rule.next;
    return rule || null;
}
const t = Tag.define;
const comment = t(), name = t(), typeName = t(name), propertyName = t(name), literal = t(), string = t(literal), number = t(literal), content = t(), heading = t(content), keyword = t(), operator = t(), punctuation = t(), bracket = t(punctuation), meta = t();
/**
The default set of highlighting [tags](#highlight.Tag).

This collection is heavily biased towards programming languages,
and necessarily incomplete. A full ontology of syntactic
constructs would fill a stack of books, and be impractical to
write themes for. So try to make do with this set. If all else
fails, [open an
issue](https://github.com/codemirror/codemirror.next) to propose a
new tag, or [define](#highlight.Tag^define) a local custom tag for
your use case.

Note that it is not obligatory to always attach the most specific
tag possible to an element—if your grammar can't easily
distinguish a certain type of element (such as a local variable),
it is okay to style it as its more general variant (a variable).

For tags that extend some parent tag, the documentation links to
the parent.
*/
const tags = {
    /**
    A comment.
    */
    comment,
    /**
    A line [comment](#highlight.tags.comment).
    */
    lineComment: t(comment),
    /**
    A block [comment](#highlight.tags.comment).
    */
    blockComment: t(comment),
    /**
    A documentation [comment](#highlight.tags.comment).
    */
    docComment: t(comment),
    /**
    Any kind of identifier.
    */
    name,
    /**
    The [name](#highlight.tags.name) of a variable.
    */
    variableName: t(name),
    /**
    A type [name](#highlight.tags.name).
    */
    typeName: typeName,
    /**
    A tag name (subtag of [`typeName`](#highlight.tags.typeName)).
    */
    tagName: t(typeName),
    /**
    A property or field [name](#highlight.tags.name).
    */
    propertyName: propertyName,
    /**
    An attribute name (subtag of [`propertyName`](#highlight.tags.propertyName)).
    */
    attributeName: t(propertyName),
    /**
    The [name](#highlight.tags.name) of a class.
    */
    className: t(name),
    /**
    A label [name](#highlight.tags.name).
    */
    labelName: t(name),
    /**
    A namespace [name](#highlight.tags.name).
    */
    namespace: t(name),
    /**
    The [name](#highlight.tags.name) of a macro.
    */
    macroName: t(name),
    /**
    A literal value.
    */
    literal,
    /**
    A string [literal](#highlight.tags.literal).
    */
    string,
    /**
    A documentation [string](#highlight.tags.string).
    */
    docString: t(string),
    /**
    A character literal (subtag of [string](#highlight.tags.string)).
    */
    character: t(string),
    /**
    An attribute value (subtag of [string](#highlight.tags.string)).
    */
    attributeValue: t(string),
    /**
    A number [literal](#highlight.tags.literal).
    */
    number,
    /**
    An integer [number](#highlight.tags.number) literal.
    */
    integer: t(number),
    /**
    A floating-point [number](#highlight.tags.number) literal.
    */
    float: t(number),
    /**
    A boolean [literal](#highlight.tags.literal).
    */
    bool: t(literal),
    /**
    Regular expression [literal](#highlight.tags.literal).
    */
    regexp: t(literal),
    /**
    An escape [literal](#highlight.tags.literal), for example a
    backslash escape in a string.
    */
    escape: t(literal),
    /**
    A color [literal](#highlight.tags.literal).
    */
    color: t(literal),
    /**
    A URL [literal](#highlight.tags.literal).
    */
    url: t(literal),
    /**
    A language keyword.
    */
    keyword,
    /**
    The [keyword](#highlight.tags.keyword) for the self or this
    object.
    */
    self: t(keyword),
    /**
    The [keyword](#highlight.tags.keyword) for null.
    */
    null: t(keyword),
    /**
    A [keyword](#highlight.tags.keyword) denoting some atomic value.
    */
    atom: t(keyword),
    /**
    A [keyword](#highlight.tags.keyword) that represents a unit.
    */
    unit: t(keyword),
    /**
    A modifier [keyword](#highlight.tags.keyword).
    */
    modifier: t(keyword),
    /**
    A [keyword](#highlight.tags.keyword) that acts as an operator.
    */
    operatorKeyword: t(keyword),
    /**
    A control-flow related [keyword](#highlight.tags.keyword).
    */
    controlKeyword: t(keyword),
    /**
    A [keyword](#highlight.tags.keyword) that defines something.
    */
    definitionKeyword: t(keyword),
    /**
    A [keyword](#highlight.tags.keyword) related to defining or
    interfacing with modules.
    */
    moduleKeyword: t(keyword),
    /**
    An operator.
    */
    operator,
    /**
    An [operator](#highlight.tags.operator) that dereferences something.
    */
    derefOperator: t(operator),
    /**
    Arithmetic-related [operator](#highlight.tags.operator).
    */
    arithmeticOperator: t(operator),
    /**
    Logical [operator](#highlight.tags.operator).
    */
    logicOperator: t(operator),
    /**
    Bit [operator](#highlight.tags.operator).
    */
    bitwiseOperator: t(operator),
    /**
    Comparison [operator](#highlight.tags.operator).
    */
    compareOperator: t(operator),
    /**
    [Operator](#highlight.tags.operator) that updates its operand.
    */
    updateOperator: t(operator),
    /**
    [Operator](#highlight.tags.operator) that defines something.
    */
    definitionOperator: t(operator),
    /**
    Type-related [operator](#highlight.tags.operator).
    */
    typeOperator: t(operator),
    /**
    Control-flow [operator](#highlight.tags.operator).
    */
    controlOperator: t(operator),
    /**
    Program or markup punctuation.
    */
    punctuation,
    /**
    [Punctuation](#highlight.tags.punctuation) that separates
    things.
    */
    separator: t(punctuation),
    /**
    Bracket-style [punctuation](#highlight.tags.punctuation).
    */
    bracket,
    /**
    Angle [brackets](#highlight.tags.bracket) (usually `<` and `>`
    tokens).
    */
    angleBracket: t(bracket),
    /**
    Square [brackets](#highlight.tags.bracket) (usually `[` and `]`
    tokens).
    */
    squareBracket: t(bracket),
    /**
    Parentheses (usually `(` and `)` tokens). Subtag of
    [bracket](#highlight.tags.bracket).
    */
    paren: t(bracket),
    /**
    Braces (usually `{` and `}` tokens). Subtag of
    [bracket](#highlight.tags.bracket).
    */
    brace: t(bracket),
    /**
    Content, for example plain text in XML or markup documents.
    */
    content,
    /**
    [Content](#highlight.tags.content) that represents a heading.
    */
    heading,
    /**
    A level 1 [heading](#highlight.tags.heading).
    */
    heading1: t(heading),
    /**
    A level 2 [heading](#highlight.tags.heading).
    */
    heading2: t(heading),
    /**
    A level 3 [heading](#highlight.tags.heading).
    */
    heading3: t(heading),
    /**
    A level 4 [heading](#highlight.tags.heading).
    */
    heading4: t(heading),
    /**
    A level 5 [heading](#highlight.tags.heading).
    */
    heading5: t(heading),
    /**
    A level 6 [heading](#highlight.tags.heading).
    */
    heading6: t(heading),
    /**
    A prose [content](#highlight.tags.content) separator (such as a horizontal rule).
    */
    contentSeparator: t(content),
    /**
    [Content](#highlight.tags.content) that represents a list.
    */
    list: t(content),
    /**
    [Content](#highlight.tags.content) that represents a quote.
    */
    quote: t(content),
    /**
    [Content](#highlight.tags.content) that is emphasized.
    */
    emphasis: t(content),
    /**
    [Content](#highlight.tags.content) that is styled strong.
    */
    strong: t(content),
    /**
    [Content](#highlight.tags.content) that is part of a link.
    */
    link: t(content),
    /**
    [Content](#highlight.tags.content) that is styled as code or
    monospace.
    */
    monospace: t(content),
    /**
    [Content](#highlight.tags.content) that has a strike-through
    style.
    */
    strikethrough: t(content),
    /**
    Inserted text in a change-tracking format.
    */
    inserted: t(),
    /**
    Deleted text.
    */
    deleted: t(),
    /**
    Changed text.
    */
    changed: t(),
    /**
    An invalid or unsyntactic element.
    */
    invalid: t(),
    /**
    Metadata or meta-instruction.
    */
    meta,
    /**
    [Metadata](#highlight.tags.meta) that applies to the entire
    document.
    */
    documentMeta: t(meta),
    /**
    [Metadata](#highlight.tags.meta) that annotates or adds
    attributes to a given syntactic element.
    */
    annotation: t(meta),
    /**
    Processing instruction or preprocessor directive. Subtag of
    [meta](#highlight.tags.meta).
    */
    processingInstruction: t(meta),
    /**
    [Modifier](#highlight.Tag^defineModifier) that indicates that a
    given element is being defined. Expected to be used with the
    various [name](#highlight.tags.name) tags.
    */
    definition: Tag.defineModifier("definition"),
    /**
    [Modifier](#highlight.Tag^defineModifier) that indicates that
    something is constant. Mostly expected to be used with
    [variable names](#highlight.tags.variableName).
    */
    constant: Tag.defineModifier("constant"),
    /**
    [Modifier](#highlight.Tag^defineModifier) used to indicate that
    a [variable](#highlight.tags.variableName) or [property
    name](#highlight.tags.propertyName) is being called or defined
    as a function.
    */
    function: Tag.defineModifier("function"),
    /**
    [Modifier](#highlight.Tag^defineModifier) that can be applied to
    [names](#highlight.tags.name) to indicate that they belong to
    the language's standard environment.
    */
    standard: Tag.defineModifier("standard"),
    /**
    [Modifier](#highlight.Tag^defineModifier) that indicates a given
    [names](#highlight.tags.name) is local to some scope.
    */
    local: Tag.defineModifier("local"),
    /**
    A generic variant [modifier](#highlight.Tag^defineModifier) that
    can be used to tag language-specific alternative variants of
    some common tag. It is recommended for themes to define special
    forms of at least the [string](#highlight.tags.string) and
    [variable name](#highlight.tags.variableName) tags, since those
    come up a lot.
    */
    special: Tag.defineModifier("special")
};
for (let name in tags) {
    let val = tags[name];
    if (val instanceof Tag)
        val.name = name;
}
/**
This is a highlighter that adds stable, predictable classes to
tokens, for styling with external CSS.

The following tags are mapped to their name prefixed with `"tok-"`
(for example `"tok-comment"`):

* [`link`](#highlight.tags.link)
* [`heading`](#highlight.tags.heading)
* [`emphasis`](#highlight.tags.emphasis)
* [`strong`](#highlight.tags.strong)
* [`keyword`](#highlight.tags.keyword)
* [`atom`](#highlight.tags.atom)
* [`bool`](#highlight.tags.bool)
* [`url`](#highlight.tags.url)
* [`labelName`](#highlight.tags.labelName)
* [`inserted`](#highlight.tags.inserted)
* [`deleted`](#highlight.tags.deleted)
* [`literal`](#highlight.tags.literal)
* [`string`](#highlight.tags.string)
* [`number`](#highlight.tags.number)
* [`variableName`](#highlight.tags.variableName)
* [`typeName`](#highlight.tags.typeName)
* [`namespace`](#highlight.tags.namespace)
* [`className`](#highlight.tags.className)
* [`macroName`](#highlight.tags.macroName)
* [`propertyName`](#highlight.tags.propertyName)
* [`operator`](#highlight.tags.operator)
* [`comment`](#highlight.tags.comment)
* [`meta`](#highlight.tags.meta)
* [`punctuation`](#highlight.tags.punctuation)
* [`invalid`](#highlight.tags.invalid)

In addition, these mappings are provided:

* [`regexp`](#highlight.tags.regexp),
  [`escape`](#highlight.tags.escape), and
  [`special`](#highlight.tags.special)[`(string)`](#highlight.tags.string)
  are mapped to `"tok-string2"`
* [`special`](#highlight.tags.special)[`(variableName)`](#highlight.tags.variableName)
  to `"tok-variableName2"`
* [`local`](#highlight.tags.local)[`(variableName)`](#highlight.tags.variableName)
  to `"tok-variableName tok-local"`
* [`definition`](#highlight.tags.definition)[`(variableName)`](#highlight.tags.variableName)
  to `"tok-variableName tok-definition"`
* [`definition`](#highlight.tags.definition)[`(propertyName)`](#highlight.tags.propertyName)
  to `"tok-propertyName tok-definition"`
*/
tagHighlighter([
    { tag: tags.link, class: "tok-link" },
    { tag: tags.heading, class: "tok-heading" },
    { tag: tags.emphasis, class: "tok-emphasis" },
    { tag: tags.strong, class: "tok-strong" },
    { tag: tags.keyword, class: "tok-keyword" },
    { tag: tags.atom, class: "tok-atom" },
    { tag: tags.bool, class: "tok-bool" },
    { tag: tags.url, class: "tok-url" },
    { tag: tags.labelName, class: "tok-labelName" },
    { tag: tags.inserted, class: "tok-inserted" },
    { tag: tags.deleted, class: "tok-deleted" },
    { tag: tags.literal, class: "tok-literal" },
    { tag: tags.string, class: "tok-string" },
    { tag: tags.number, class: "tok-number" },
    { tag: [tags.regexp, tags.escape, tags.special(tags.string)], class: "tok-string2" },
    { tag: tags.variableName, class: "tok-variableName" },
    { tag: tags.local(tags.variableName), class: "tok-variableName tok-local" },
    { tag: tags.definition(tags.variableName), class: "tok-variableName tok-definition" },
    { tag: tags.special(tags.variableName), class: "tok-variableName2" },
    { tag: tags.definition(tags.propertyName), class: "tok-propertyName tok-definition" },
    { tag: tags.typeName, class: "tok-typeName" },
    { tag: tags.namespace, class: "tok-namespace" },
    { tag: tags.className, class: "tok-className" },
    { tag: tags.macroName, class: "tok-macroName" },
    { tag: tags.propertyName, class: "tok-propertyName" },
    { tag: tags.operator, class: "tok-operator" },
    { tag: tags.comment, class: "tok-comment" },
    { tag: tags.meta, class: "tok-meta" },
    { tag: tags.invalid, class: "tok-invalid" },
    { tag: tags.punctuation, class: "tok-punctuation" }
]);

const deletedChunkGutterMarker = new class extends view.GutterMarker {
    constructor() {
        super(...arguments);
        this.elementClass = "cm-deletedLineGutter";
    }
};
const unifiedChangeGutter = state.Prec.low(view.gutter({
    class: "cm-changeGutter",
    markers: view => view.plugin(decorateChunks)?.gutter || state.RangeSet.empty,
    widgetMarker: (_, widget) => widget instanceof DeletionWidget ? deletedChunkGutterMarker : null
}));
/// Create an extension that causes the editor to display changes
/// between its content and the given original document. Changed
/// chunks will be highlighted, with uneditable widgets displaying the
/// original text displayed above the new text.
function unifiedMergeView(config) {
    let orig = typeof config.original == "string" ? state.Text.of(config.original.split(/\r?\n/)) : config.original;
    let diffConf = config.diffConfig || defaultDiffConfig;
    return [
        state.Prec.low(decorateChunks),
        deletedChunks,
        baseTheme,
        view.EditorView.editorAttributes.of({ class: "cm-merge-b" }),
        state.EditorState.transactionExtender.of(tr => {
            let updateDoc = tr.effects.find(e => e.is(updateOriginalDoc));
            if (!tr.docChanged && !updateDoc)
                return null;
            let prev = tr.startState.field(ChunkField);
            let chunks = updateDoc ? Chunk.updateA(prev, updateDoc.value.doc, tr.newDoc, updateDoc.value.changes, diffConf)
                : Chunk.updateB(prev, tr.startState.field(originalDoc), tr.newDoc, tr.changes, diffConf);
            return { effects: setChunks.of(chunks) };
        }),
        commands.invertedEffects.of(tr => {
            let effects = [];
            for (let effect of tr.effects) {
                if (effect.is(updateOriginalDoc)) {
                    // Create the inverse effect that restores the previous original doc
                    let prevDoc = getOriginalDoc(tr.startState);
                    let inverseChanges = effect.value.changes.invert(effect.value.doc);
                    effects.push(updateOriginalDoc.of({ doc: prevDoc, changes: inverseChanges }));
                }
            }
            return effects;
        }),
        mergeConfig.of({
            highlightChanges: config.highlightChanges !== false,
            markGutter: config.gutter !== false,
            syntaxHighlightDeletions: config.syntaxHighlightDeletions !== false,
            syntaxHighlightDeletionsMaxLength: 3000,
            mergeControls: config.mergeControls !== false,
            overrideChunk: config.allowInlineDiffs ? overrideChunkInline : undefined,
            side: "b"
        }),
        originalDoc.init(() => orig),
        config.gutter !== false ? unifiedChangeGutter : [],
        config.collapseUnchanged ? collapseUnchanged(config.collapseUnchanged) : [],
        ChunkField.init(state => Chunk.build(orig, state.doc, diffConf))
    ];
}
/// The state effect used to signal changes in the original doc in a
/// unified merge view.
const updateOriginalDoc = state.StateEffect.define();
/// Create an effect that, when added to a transaction on a unified
/// merge view, will update the original document that's being compared against.
function originalDocChangeEffect(state, changes) {
    return updateOriginalDoc.of({ doc: changes.apply(getOriginalDoc(state)), changes });
}
const originalDoc = state.StateField.define({
    create: () => state.Text.empty,
    update(doc, tr) {
        for (let e of tr.effects)
            if (e.is(updateOriginalDoc))
                doc = e.value.doc;
        return doc;
    }
});
/// Get the original document from a unified merge editor's state.
function getOriginalDoc(state) {
    return state.field(originalDoc);
}
const DeletionWidgets = new WeakMap;
class DeletionWidget extends view.WidgetType {
    constructor(buildDOM) {
        super();
        this.buildDOM = buildDOM;
        this.dom = null;
    }
    eq(other) { return this.dom == other.dom; }
    toDOM(view) { return this.dom || (this.dom = this.buildDOM(view)); }
}
function deletionWidget(state, chunk, hideContent) {
    let known = DeletionWidgets.get(chunk.changes);
    if (known)
        return known;
    let buildDOM = (view) => {
        let { highlightChanges, syntaxHighlightDeletions, syntaxHighlightDeletionsMaxLength, mergeControls } = state.facet(mergeConfig);
        let dom = document.createElement("div");
        dom.className = "cm-deletedChunk";
        if (mergeControls) {
            let buttons = dom.appendChild(document.createElement("div"));
            buttons.className = "cm-chunkButtons";
            let accept = buttons.appendChild(document.createElement("button"));
            accept.name = "accept";
            accept.textContent = state.phrase("Accept");
            accept.onmousedown = e => { e.preventDefault(); acceptChunk(view, view.posAtDOM(dom)); };
            let reject = buttons.appendChild(document.createElement("button"));
            reject.name = "reject";
            reject.textContent = state.phrase("Reject");
            reject.onmousedown = e => { e.preventDefault(); rejectChunk(view, view.posAtDOM(dom)); };
        }
        if (hideContent || chunk.fromA >= chunk.toA)
            return dom;
        let text = view.state.field(originalDoc).sliceString(chunk.fromA, chunk.endA);
        let lang = syntaxHighlightDeletions && state.facet(language.language);
        let line = makeLine();
        let changes = chunk.changes, changeI = 0, inside = false;
        function makeLine() {
            let div = dom.appendChild(document.createElement("div"));
            div.className = "cm-deletedLine";
            return div.appendChild(document.createElement("del"));
        }
        function add(from, to, cls) {
            for (let at = from; at < to;) {
                if (text.charAt(at) == "\n") {
                    if (!line.firstChild)
                        line.appendChild(document.createElement("br"));
                    line = makeLine();
                    at++;
                    continue;
                }
                let nextStop = to, nodeCls = cls + (inside ? " cm-deletedText" : ""), flip = false;
                let newline = text.indexOf("\n", at);
                if (newline > -1 && newline < to)
                    nextStop = newline;
                if (highlightChanges && changeI < changes.length) {
                    let nextBound = Math.max(0, inside ? changes[changeI].toA : changes[changeI].fromA);
                    if (nextBound <= nextStop) {
                        nextStop = nextBound;
                        if (inside)
                            changeI++;
                        flip = true;
                    }
                }
                if (nextStop > at) {
                    let node = document.createTextNode(text.slice(at, nextStop));
                    if (nodeCls) {
                        let span = line.appendChild(document.createElement("span"));
                        span.className = nodeCls;
                        span.appendChild(node);
                    }
                    else {
                        line.appendChild(node);
                    }
                    at = nextStop;
                }
                if (flip)
                    inside = !inside;
            }
        }
        if (lang && chunk.toA - chunk.fromA <= syntaxHighlightDeletionsMaxLength) {
            let tree = lang.parser.parse(text), pos = 0;
            highlightTree(tree, { style: tags => language.highlightingFor(state, tags) }, (from, to, cls) => {
                if (from > pos)
                    add(pos, from, "");
                add(from, to, cls);
                pos = to;
            });
            add(pos, text.length, "");
        }
        else {
            add(0, text.length, "");
        }
        if (!line.firstChild)
            line.appendChild(document.createElement("br"));
        return dom;
    };
    let deco = view.Decoration.widget({
        block: true,
        side: -1,
        widget: new DeletionWidget(buildDOM)
    });
    DeletionWidgets.set(chunk.changes, deco);
    return deco;
}
/// In a [unified](#merge.unifiedMergeView) merge view, accept the
/// chunk under the given position or the cursor. This chunk will no
/// longer be highlighted unless it is edited again.
function acceptChunk(view, pos) {
    let { state: state$1 } = view, at = pos ?? state$1.selection.main.head;
    let chunk = view.state.field(ChunkField).find(ch => ch.fromB <= at && ch.endB >= at);
    if (!chunk)
        return false;
    let insert = view.state.sliceDoc(chunk.fromB, Math.max(chunk.fromB, chunk.toB - 1));
    let orig = view.state.field(originalDoc);
    if (chunk.fromB != chunk.toB && chunk.toA <= orig.length)
        insert += view.state.lineBreak;
    let changes = state.ChangeSet.of({ from: chunk.fromA, to: Math.min(orig.length, chunk.toA), insert }, orig.length);
    view.dispatch({
        effects: updateOriginalDoc.of({ doc: changes.apply(orig), changes }),
        userEvent: "accept"
    });
    return true;
}
/// In a [unified](#merge.unifiedMergeView) merge view, reject the
/// chunk under the given position or the cursor. Reverts that range
/// to the content it has in the original document.
function rejectChunk(view, pos) {
    let { state } = view, at = pos ?? state.selection.main.head;
    let chunk = state.field(ChunkField).find(ch => ch.fromB <= at && ch.endB >= at);
    if (!chunk)
        return false;
    let orig = state.field(originalDoc);
    let insert = orig.sliceString(chunk.fromA, Math.max(chunk.fromA, chunk.toA - 1));
    if (chunk.fromA != chunk.toA && chunk.toB <= state.doc.length)
        insert += state.lineBreak;
    view.dispatch({
        changes: { from: chunk.fromB, to: Math.min(state.doc.length, chunk.toB), insert },
        userEvent: "revert"
    });
    return true;
}
/// In a [unified](#merge.unifiedMergeView) merge view, accept all
/// chunks in a single transaction. This allows undoing all accepts
/// as one operation and is more efficient than accepting chunks individually.
function acceptAllChunksUnifiedView(view) {
    let { state: state$1 } = view;
    let chunks = state$1.field(ChunkField);
    if (!chunks || chunks.length === 0)
        return false;
    let orig = state$1.field(originalDoc);
    let changes = [];
    // Process chunks in reverse order to maintain correct positions
    for (let i = chunks.length - 1; i >= 0; i--) {
        let chunk = chunks[i];
        let insert = state$1.sliceDoc(chunk.fromB, Math.max(chunk.fromB, chunk.toB - 1));
        if (chunk.fromB != chunk.toB && chunk.toA <= orig.length)
            insert += state$1.lineBreak;
        changes.push({
            from: chunk.fromA,
            to: Math.min(orig.length, chunk.toA),
            insert
        });
    }
    // Combine all changes into a single ChangeSet
    let combinedChanges = state.ChangeSet.of(changes, orig.length);
    view.dispatch({
        effects: updateOriginalDoc.of({ doc: combinedChanges.apply(orig), changes: combinedChanges }),
        userEvent: "accept.all"
    });
    return true;
}
function buildDeletedChunks(state$1) {
    let builder = new state.RangeSetBuilder();
    for (let ch of state$1.field(ChunkField)) {
        let hide = state$1.facet(mergeConfig).overrideChunk && chunkCanDisplayInline(state$1, ch);
        builder.add(ch.fromB, ch.fromB, deletionWidget(state$1, ch, !!hide));
    }
    return builder.finish();
}
const deletedChunks = state.StateField.define({
    create: state => buildDeletedChunks(state),
    update(deco, tr) {
        return tr.state.field(ChunkField, false) != tr.startState.field(ChunkField, false) ? buildDeletedChunks(tr.state) : deco;
    },
    provide: f => view.EditorView.decorations.from(f)
});
const InlineChunkCache = new WeakMap();
function chunkCanDisplayInline(state, chunk) {
    let result = InlineChunkCache.get(chunk);
    if (result !== undefined)
        return result;
    result = null;
    let a = state.field(originalDoc), b = state.doc;
    let linesA = a.lineAt(chunk.endA).number - a.lineAt(chunk.fromA).number + 1;
    let linesB = b.lineAt(chunk.endB).number - b.lineAt(chunk.fromB).number + 1;
    abort: if (linesA == linesB && linesA < 10) {
        let deco = [], deleteCount = 0;
        let bA = chunk.fromA, bB = chunk.fromB;
        for (let ch of chunk.changes) {
            if (ch.fromA < ch.toA) {
                deleteCount += ch.toA - ch.fromA;
                let deleted = a.sliceString(bA + ch.fromA, bA + ch.toA);
                if (/\n/.test(deleted))
                    break abort;
                deco.push(view.Decoration.widget({ widget: new InlineDeletion(deleted), side: -1 }).range(bB + ch.fromB));
            }
            if (ch.fromB < ch.toB) {
                deco.push(changedText.range(bB + ch.fromB, bB + ch.toB));
            }
        }
        if (deleteCount < (chunk.endA - chunk.fromA - linesA * 2))
            result = deco;
    }
    InlineChunkCache.set(chunk, result);
    return result;
}
class InlineDeletion extends view.WidgetType {
    constructor(text) {
        super();
        this.text = text;
    }
    eq(other) { return this.text == other.text; }
    toDOM(_) {
        let elt = document.createElement("del");
        elt.className = "cm-deletedText";
        elt.textContent = this.text;
        return elt;
    }
}
const inlineChangedLineGutterMarker = new class extends view.GutterMarker {
    constructor() {
        super(...arguments);
        this.elementClass = "cm-inlineChangedLineGutter";
    }
};
const inlineChangedLine = view.Decoration.line({ class: "cm-inlineChangedLine" });
function overrideChunkInline(state, chunk, builder, gutterBuilder) {
    let inline = chunkCanDisplayInline(state, chunk), i = 0;
    if (!inline)
        return false;
    for (let line = state.doc.lineAt(chunk.fromB);;) {
        if (gutterBuilder)
            gutterBuilder.add(line.from, line.from, inlineChangedLineGutterMarker);
        builder.add(line.from, line.from, inlineChangedLine);
        while (i < inline.length && inline[i].to <= line.to) {
            let r = inline[i++];
            builder.add(r.from, r.to, r.value);
        }
        if (line.to >= chunk.endB)
            break;
        line = state.doc.lineAt(line.to + 1);
    }
    return true;
}

exports.Chunk = Chunk;
exports.MergeView = MergeView;
exports.acceptAllChunksMergeView = acceptAllChunksMergeView;
exports.acceptAllChunksUnifiedView = acceptAllChunksUnifiedView;
exports.acceptChunk = acceptChunk;
exports.defaultMergeKeymap = defaultMergeKeymap;
exports.diff = diff;
exports.getChunks = getChunks;
exports.getOriginalDoc = getOriginalDoc;
exports.goToNextChunk = goToNextChunk;
exports.goToPreviousChunk = goToPreviousChunk;
exports.mergeKeymap = mergeKeymap;
exports.originalDocChangeEffect = originalDocChangeEffect;
exports.presentableDiff = presentableDiff;
exports.rejectChunk = rejectChunk;
exports.unifiedMergeView = unifiedMergeView;
exports.updateOriginalDoc = updateOriginalDoc;
//# sourceMappingURL=index.js.map
