"use strict";

const FILES = "abcdefgh";
const PIECES = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟"
};
const VALUES = { q: 9, r: 5, b: 3, n: 3, p: 1 };
const boardElement = document.querySelector("#chessboard");
const moveListElement = document.querySelector("#move-list");
const toastElement = document.querySelector("#toast");
const promotionDialog = document.querySelector("#promotion-dialog");
const newGameDialog = document.querySelector("#new-game-dialog");

let state;
let history = [];
let selectedSquare = null;
let legalMoves = [];
let orientation = "w";
let toastTimeout;
let soundEnabled = false;
let clockRemaining = { w: 600000, b: 600000 };
let clockTimer = null;
let clockStarted = false;
let clockLastTick = 0;

function initialBoard() {
  return [
    [..."rnbqkbnr"],
    Array(8).fill("p"),
    Array(8).fill(null), Array(8).fill(null), Array(8).fill(null), Array(8).fill(null),
    Array(8).fill("P"),
    [..."RNBQKBNR"]
  ];
}

function freshState() {
  const next = {
    board: initialBoard(), turn: "w", castling: { K: true, Q: true, k: true, q: true },
    enPassant: null, halfmove: 0, fullmove: 1, lastMove: null,
    captured: { w: [], b: [] }, repetitions: {}, status: "playing", inCheck: false
  };
  next.repetitions[positionKey(next)] = 1;
  return next;
}

function copyState(source) {
  return {
    ...source,
    board: source.board.map(row => row.slice()),
    castling: { ...source.castling },
    lastMove: source.lastMove ? { from: [...source.lastMove.from], to: [...source.lastMove.to] } : null,
    captured: { w: [...source.captured.w], b: [...source.captured.b] },
    repetitions: { ...source.repetitions }
  };
}

function inside(row, col) { return row >= 0 && row < 8 && col >= 0 && col < 8; }
function colorOf(piece) { return piece && (piece === piece.toUpperCase() ? "w" : "b"); }
function pieceAt(position, row, col) { return inside(row, col) ? position.board[row][col] : null; }
function sameSquare(a, b) { return a[0] === b[0] && a[1] === b[1]; }
function opposite(color) { return color === "w" ? "b" : "w"; }
function squareName(square) { return `${FILES[square[1]]}${8 - square[0]}`; }

function findKing(position, color) {
  const king = color === "w" ? "K" : "k";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (position.board[row][col] === king) return [row, col];
    }
  }
  return null;
}

function isSquareAttacked(position, row, col, byColor) {
  const pawnRow = row + (byColor === "w" ? 1 : -1);
  const pawn = byColor === "w" ? "P" : "p";
  for (const dc of [-1, 1]) {
    if (pieceAt(position, pawnRow, col + dc) === pawn) return true;
  }

  const knight = byColor === "w" ? "N" : "n";
  for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
    if (pieceAt(position, row + dr, col + dc) === knight) return true;
  }

  const king = byColor === "w" ? "K" : "k";
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if ((dr || dc) && pieceAt(position, row + dr, col + dc) === king) return true;
    }
  }

  for (const [dr, dc, attackers] of [
    [-1, 0, "rq"], [1, 0, "rq"], [0, -1, "rq"], [0, 1, "rq"],
    [-1, -1, "bq"], [-1, 1, "bq"], [1, -1, "bq"], [1, 1, "bq"]
  ]) {
    let r = row + dr;
    let c = col + dc;
    while (inside(r, c)) {
      const piece = position.board[r][c];
      if (piece) {
        if (colorOf(piece) === byColor && attackers.includes(piece.toLowerCase())) return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }
  return false;
}

function isInCheck(position, color) {
  const king = findKing(position, color);
  return king ? isSquareAttacked(position, king[0], king[1], opposite(color)) : true;
}

function pseudoMoves(position, row, col) {
  const piece = position.board[row][col];
  if (!piece) return [];
  const color = colorOf(piece);
  const kind = piece.toLowerCase();
  const moves = [];
  const add = (toRow, toCol, extras = {}) => {
    if (!inside(toRow, toCol)) return false;
    const target = pieceAt(position, toRow, toCol);
    if (target && (colorOf(target) === color || target.toLowerCase() === "k")) return false;
    moves.push({ from: [row, col], to: [toRow, toCol], ...extras });
    return !target;
  };

  if (kind === "p") {
    const direction = color === "w" ? -1 : 1;
    const startRow = color === "w" ? 6 : 1;
    const promotionRow = color === "w" ? 0 : 7;
    const oneRow = row + direction;
    if (inside(oneRow, col) && !pieceAt(position, oneRow, col)) {
      add(oneRow, col, oneRow === promotionRow ? { promotion: true } : {});
      const twoRow = row + 2 * direction;
      if (row === startRow && !pieceAt(position, twoRow, col)) add(twoRow, col, { doublePawn: true });
    }
    for (const dc of [-1, 1]) {
      const targetRow = row + direction;
      const targetCol = col + dc;
      const target = pieceAt(position, targetRow, targetCol);
      if (target && colorOf(target) !== color && target.toLowerCase() !== "k") {
        add(targetRow, targetCol, targetRow === promotionRow ? { promotion: true } : {});
      } else if (position.enPassant && sameSquare(position.enPassant, [targetRow, targetCol])) {
        moves.push({ from: [row, col], to: [targetRow, targetCol], enPassant: true });
      }
    }
  } else if (kind === "n") {
    for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) add(row + dr, col + dc);
  } else if (kind === "b" || kind === "r" || kind === "q") {
    const directions = [];
    if (kind !== "r") directions.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
    if (kind !== "b") directions.push([-1, 0], [1, 0], [0, -1], [0, 1]);
    for (const [dr, dc] of directions) {
      let toRow = row + dr;
      let toCol = col + dc;
      while (add(toRow, toCol)) {
        toRow += dr;
        toCol += dc;
      }
    }
  } else if (kind === "k") {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) if (dr || dc) add(row + dr, col + dc);
    }
    const homeRow = color === "w" ? 7 : 0;
    const enemy = opposite(color);
    if (row === homeRow && col === 4 && !isInCheck(position, color)) {
      const kingRight = color === "w" ? "K" : "k";
      const queenRight = color === "w" ? "Q" : "q";
      const rook = color === "w" ? "R" : "r";
      if (position.castling[kingRight] && position.board[homeRow][7] === rook &&
          !position.board[homeRow][5] && !position.board[homeRow][6] &&
          !isSquareAttacked(position, homeRow, 5, enemy) && !isSquareAttacked(position, homeRow, 6, enemy)) {
        add(homeRow, 6, { castle: "king" });
      }
      if (position.castling[queenRight] && position.board[homeRow][0] === rook &&
          !position.board[homeRow][1] && !position.board[homeRow][2] && !position.board[homeRow][3] &&
          !isSquareAttacked(position, homeRow, 3, enemy) && !isSquareAttacked(position, homeRow, 2, enemy)) {
        add(homeRow, 2, { castle: "queen" });
      }
    }
  }
  return moves;
}

function applyMove(position, move, promotionPiece = null) {
  const next = copyState(position);
  const [fromRow, fromCol] = move.from;
  const [toRow, toCol] = move.to;
  const piece = next.board[fromRow][fromCol];
  let captured = next.board[toRow][toCol];

  if (move.enPassant) {
    captured = next.board[fromRow][toCol];
    next.board[fromRow][toCol] = null;
  }
  next.board[fromRow][fromCol] = null;
  next.board[toRow][toCol] = move.promotion
    ? (promotionPiece || (colorOf(piece) === "w" ? "Q" : "q"))
    : piece;

  if (move.castle) {
    const rookFrom = move.castle === "king" ? 7 : 0;
    const rookTo = move.castle === "king" ? 5 : 3;
    next.board[toRow][rookTo] = next.board[toRow][rookFrom];
    next.board[toRow][rookFrom] = null;
  }

  if (piece.toLowerCase() === "k") {
    if (colorOf(piece) === "w") { next.castling.K = false; next.castling.Q = false; }
    else { next.castling.k = false; next.castling.q = false; }
  }
  if (piece === "R" && fromRow === 7 && fromCol === 0) next.castling.Q = false;
  if (piece === "R" && fromRow === 7 && fromCol === 7) next.castling.K = false;
  if (piece === "r" && fromRow === 0 && fromCol === 0) next.castling.q = false;
  if (piece === "r" && fromRow === 0 && fromCol === 7) next.castling.k = false;
  if (captured === "R" && toRow === 7 && toCol === 0) next.castling.Q = false;
  if (captured === "R" && toRow === 7 && toCol === 7) next.castling.K = false;
  if (captured === "r" && toRow === 0 && toCol === 0) next.castling.q = false;
  if (captured === "r" && toRow === 0 && toCol === 7) next.castling.k = false;

  next.enPassant = move.doublePawn ? [(fromRow + toRow) / 2, fromCol] : null;
  next.halfmove = piece.toLowerCase() === "p" || captured ? 0 : next.halfmove + 1;
  if (colorOf(piece) === "b") next.fullmove += 1;
  if (captured) next.captured[colorOf(piece)].push(captured);
  next.lastMove = { from: [...move.from], to: [...move.to] };
  next.turn = opposite(position.turn);
  next.status = "playing";
  return { position: next, captured, piece };
}

function legalMovesFor(position, color = position.turn) {
  const legal = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = position.board[row][col];
      if (!piece || colorOf(piece) !== color) continue;
      for (const move of pseudoMoves(position, row, col)) {
        const { position: next } = applyMove(position, move);
        if (!isInCheck(next, color)) legal.push(move);
      }
    }
  }
  return legal;
}

function positionKey(position) {
  const rows = position.board.map(row => row.map(piece => piece || ".").join("")).join("/");
  const castling = ["K", "Q", "k", "q"].filter(right => position.castling[right]).join("") || "-";
  const ep = position.enPassant ? squareName(position.enPassant) : "-";
  return `${rows} ${position.turn} ${castling} ${ep}`;
}

function insufficientMaterial(position) {
  const pieces = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = position.board[row][col];
      if (piece && piece.toLowerCase() !== "k") pieces.push({ piece: piece.toLowerCase(), square: [row, col] });
    }
  }
  if (!pieces.length) return true;
  if (pieces.length === 1 && ["b", "n"].includes(pieces[0].piece)) return true;
  if (pieces.every(item => item.piece === "b") &&
      pieces.every(item => (item.square[0] + item.square[1]) % 2 === (pieces[0].square[0] + pieces[0].square[1]) % 2)) return true;
  return false;
}

function moveNotation(position, move, promotionPiece) {
  const piece = position.board[move.from[0]][move.from[1]];
  const target = position.board[move.to[0]][move.to[1]] || (move.enPassant ? "p" : null);
  const isCapture = Boolean(target);
  let notation;
  if (move.castle === "king") notation = "O-O";
  else if (move.castle === "queen") notation = "O-O-O";
  else {
    const kind = piece.toLowerCase();
    const prefix = kind === "p" ? (isCapture ? FILES[move.from[1]] : "") : `${PIECES[piece]} `;
    notation = kind === "p"
      ? (isCapture ? `${prefix}×${squareName(move.to)}` : squareName(move.to))
      : `${prefix}${isCapture ? "×" : "–"}${squareName(move.to)}`;
    if (move.promotion) notation += `=${PIECES[promotionPiece]}`;
  }
  const { position: next } = applyMove(position, move, promotionPiece);
  const check = isInCheck(next, next.turn);
  if (check) notation += legalMovesFor(next).length ? "+" : "#";
  return notation;
}

function playMove(move, promotionPiece = null) {
  if (clockTimer !== null && !tickClock()) return;
  const notation = moveNotation(state, move, promotionPiece);
  history.push({ state: copyState(state), notation });
  const { position: next } = applyMove(state, move, promotionPiece);
  state = next;
  const key = positionKey(state);
  state.repetitions[key] = (state.repetitions[key] || 0) + 1;
  const moves = legalMovesFor(state);
  state.inCheck = isInCheck(state, state.turn);
  if (!moves.length) state.status = state.inCheck ? "checkmate" : "stalemate";
  else if (state.halfmove >= 100) state.status = "fifty-move";
  else if (state.repetitions[key] >= 3) state.status = "repetition";
  else if (insufficientMaterial(state)) state.status = "insufficient";
  if (state.status === "playing") startClock();
  else stopClock();
  selectedSquare = null;
  legalMoves = [];
  render();
  if (soundEnabled) playMoveSound();
  if (state.status !== "playing") showToast(statusMessage(state.status));
}

function statusMessage(status) {
  return {
    checkmate: `Checkmate. ${state.turn === "w" ? "Black" : "White"} wins!`,
    stalemate: "Draw by stalemate.",
    "fifty-move": "Draw by the fifty-move rule.",
    repetition: "Draw by threefold repetition.",
    insufficient: "Draw by insufficient material.",
    timeout: `${state.turn === "w" ? "White" : "Black"} ran out of time. ${state.turn === "w" ? "Black" : "White"} wins!`
  }[status] || "";
}

function requestMove(move) {
  if (move.promotion) {
    showPromotionChoices(colorOf(state.board[move.from[0]][move.from[1]]), promotionPiece => playMove(move, promotionPiece));
  } else {
    playMove(move);
  }
}

function onSquareClick(row, col) {
  if (state.status !== "playing") return;
  const piece = state.board[row][col];
  if (selectedSquare) {
    const move = legalMoves.find(item => sameSquare(item.to, [row, col]));
    if (move) {
      requestMove(move);
      return;
    }
    if (piece && colorOf(piece) === state.turn) {
      selectSquare(row, col);
      return;
    }
    selectedSquare = null;
    legalMoves = [];
    renderBoard();
    return;
  }
  if (piece && colorOf(piece) === state.turn) selectSquare(row, col);
}

function selectSquare(row, col) {
  selectedSquare = [row, col];
  legalMoves = legalMovesFor(state).filter(move => sameSquare(move.from, selectedSquare));
  renderBoard();
}

function renderBoard() {
  boardElement.replaceChildren();
  const rows = orientation === "w" ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
  const cols = orientation === "w" ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
  const checkedKing = state.inCheck ? findKing(state, state.turn) : null;
  for (const row of rows) {
    for (const col of cols) {
      const square = document.createElement("button");
      square.type = "button";
      square.className = `square ${(row + col) % 2 ? "dark" : "light"}`;
      square.setAttribute("role", "gridcell");
      square.setAttribute("aria-label", `${squareName([row, col])}${state.board[row][col] ? ` ${colorOf(state.board[row][col]) === "w" ? "white" : "black"} ${pieceName(state.board[row][col])}` : ""}`);
      square.dataset.row = row;
      square.dataset.col = col;
      if (selectedSquare && sameSquare(selectedSquare, [row, col])) square.classList.add("selected");
      if (state.lastMove && (sameSquare(state.lastMove.from, [row, col]) || sameSquare(state.lastMove.to, [row, col]))) square.classList.add("last-move");
      if (checkedKing && sameSquare(checkedKing, [row, col])) square.classList.add("in-check");
      const piece = state.board[row][col];
      if (piece) {
        square.classList.add(colorOf(piece) === "w" ? "white-piece" : "black-piece");
        const pieceSpan = document.createElement("span");
        pieceSpan.className = "piece";
        pieceSpan.textContent = PIECES[piece];
        square.append(pieceSpan);
      }
      if (legalMoves.some(move => sameSquare(move.to, [row, col]))) {
        const marker = document.createElement("span");
        marker.className = piece ? "capture-ring" : "legal-dot";
        square.append(marker);
      }
      square.addEventListener("click", () => onSquareClick(row, col));
      boardElement.append(square);
    }
  }
  renderCoordinates();
}

function renderCoordinates() {
  const rankLabels = document.querySelector("#rank-labels");
  const fileLabels = document.querySelector("#file-labels");
  rankLabels.replaceChildren();
  fileLabels.replaceChildren();
  const ranks = orientation === "w" ? "87654321" : "12345678";
  const files = orientation === "w" ? FILES : [...FILES].reverse().join("");
  for (const rank of ranks) {
    const span = document.createElement("span");
    span.textContent = rank;
    rankLabels.append(span);
  }
  for (const file of files) {
    const span = document.createElement("span");
    span.textContent = file;
    fileLabels.append(span);
  }
}

function pieceName(piece) {
  return ({ k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" })[piece.toLowerCase()];
}

function renderHistory() {
  moveListElement.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "empty-history";
    empty.innerHTML = "<span>♙</span><p>Your story starts<br>with a single move.</p>";
    moveListElement.append(empty);
    return;
  }
  for (let index = 0; index < history.length; index += 2) {
    const row = document.createElement("div");
    row.className = "move-row";
    const number = document.createElement("span");
    number.className = "move-number";
    number.textContent = `${index / 2 + 1}.`;
    const white = document.createElement("span");
    white.className = `move-cell${index === history.length - 1 ? " latest" : ""}`;
    white.textContent = history[index].notation;
    row.append(number, white);
    if (history[index + 1]) {
      const black = document.createElement("span");
      black.className = `move-cell${index + 1 === history.length - 1 ? " latest" : ""}`;
      black.textContent = history[index + 1].notation;
      row.append(black);
    }
    moveListElement.append(row);
  }
  moveListElement.scrollTop = moveListElement.scrollHeight;
}

function renderCaptured(color) {
  const element = document.querySelector(color === "w" ? "#white-captured" : "#black-captured");
  const pieces = state.captured[color].slice().sort((a, b) => VALUES[b.toLowerCase()] - VALUES[a.toLowerCase()]);
  element.replaceChildren();
  for (const piece of pieces) {
    const symbol = document.createElement("span");
    symbol.className = `captured-symbol ${colorOf(piece) === "w" ? "white-piece" : ""}`;
    symbol.textContent = PIECES[piece];
    element.append(symbol);
  }
}

function render() {
  state.inCheck = isInCheck(state, state.turn);
  renderBoard();
  renderHistory();
  renderCaptured("w");
  renderCaptured("b");
  document.querySelector("#turn-text").textContent = state.status === "playing"
    ? `${state.turn === "w" ? "White" : "Black"}${state.inCheck ? " is in check" : " to move"}`
    : statusMessage(state.status);
  document.querySelector("#move-count").textContent = `Move ${state.fullmove}`;
  document.querySelector("#turn-indicator").classList.toggle("black-turn", state.turn === "b");
  document.querySelector("#turn-indicator").classList.toggle("terminal-turn", state.status !== "playing");
  document.querySelector("#white-player").classList.toggle("is-active", state.turn === "w" && state.status === "playing");
  document.querySelector("#black-player").classList.toggle("is-active", state.turn === "b" && state.status === "playing");
  document.querySelector("#white-clock").classList.toggle("active-clock", clockStarted && state.turn === "w" && state.status === "playing");
  document.querySelector("#black-clock").classList.toggle("active-clock", clockStarted && state.turn === "b" && state.status === "playing");
  updateClockDisplay();
  document.querySelector("#white-caption").textContent = state.status === "playing"
    ? (state.turn === "w" ? (state.inCheck ? "Your king is in check." : "Your move. Make it count.") : "Thinking about your next move…")
    : statusMessage(state.status);
  document.querySelector("#undo-move").disabled = history.length === 0;
}

function formatClock(milliseconds) {
  const seconds = Math.ceil(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function updateClockDisplay() {
  document.querySelector("#white-clock").textContent = formatClock(clockRemaining.w);
  document.querySelector("#black-clock").textContent = formatClock(clockRemaining.b);
}

function startClock() {
  clockStarted = true;
  if (clockTimer !== null) return;
  clockLastTick = Date.now();
  clockTimer = setInterval(tickClock, 200);
}

function tickClock() {
  if (!clockStarted || state.status !== "playing") return false;
  const now = Date.now();
  clockRemaining[state.turn] = Math.max(0, clockRemaining[state.turn] - (now - clockLastTick));
  clockLastTick = now;
  updateClockDisplay();
  if (clockRemaining[state.turn] <= 0) {
    state.status = "timeout";
    stopClock();
    render();
    showToast(statusMessage(state.status));
    return false;
  }
  return true;
}

function stopClock() {
  if (clockTimer !== null) clearInterval(clockTimer);
  clockTimer = null;
}

function showPromotionChoices(color, onChoose) {
  const options = document.querySelector("#promotion-options");
  options.replaceChildren();
  for (const kind of ["q", "r", "b", "n"]) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "promotion-choice";
    choice.textContent = PIECES[color === "w" ? kind.toUpperCase() : kind];
    choice.setAttribute("aria-label", `Promote to ${pieceName(kind)}`);
    choice.addEventListener("click", () => {
      promotionDialog.close();
      onChoose(color === "w" ? kind.toUpperCase() : kind);
    });
    options.append(choice);
  }
  promotionDialog.showModal();
}

function showToast(message) {
  toastElement.textContent = message;
  toastElement.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastElement.classList.remove("visible"), 2600);
}

function undoMove() {
  const previous = history.pop();
  if (!previous) return;
  state = previous.state;
  selectedSquare = null;
  legalMoves = [];
  if (history.length && clockStarted) startClock();
  render();
  showToast("Last move taken back.");
}

function newGame() {
  stopClock();
  clockStarted = false;
  clockRemaining = { w: 600000, b: 600000 };
  state = freshState();
  history = [];
  selectedSquare = null;
  legalMoves = [];
  render();
}

function playMoveSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 440;
  gain.gain.setValueAtTime(0.04, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.09);
  oscillator.addEventListener("ended", () => context.close(), { once: true });
}

document.querySelector("#undo-move").addEventListener("click", undoMove);
document.querySelector("#flip-board").addEventListener("click", () => {
  orientation = orientation === "w" ? "b" : "w";
  renderBoard();
});
document.querySelector("#new-game").addEventListener("click", () => {
  if (history.length) newGameDialog.showModal();
  else newGame();
});
newGameDialog.addEventListener("close", () => {
  if (newGameDialog.returnValue === "new") newGame();
});
document.querySelector("#sound-toggle").addEventListener("click", event => {
  soundEnabled = !soundEnabled;
  event.currentTarget.setAttribute("aria-pressed", String(soundEnabled));
  event.currentTarget.title = soundEnabled ? "Turn sound off" : "Turn sound on";
  showToast(soundEnabled ? "Move sounds on." : "Move sounds off.");
});

state = freshState();
render();
