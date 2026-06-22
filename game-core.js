(function (global) {
  "use strict";

  const STORAGE_KEY = "lucky7-classroom-state-v1";
  const PLAYER_STATUS = {
    ACTIVE: "Active",
    STAYED: "Stayed",
    FROZEN: "Frozen",
    BUSTED: "Busted",
    OUT: "Out",
  };

  function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function makeCard(type, value, index) {
    const code = value === undefined || value === null ? type : `${type}-${value}`;
    return {
      id: `${code}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      value,
      label: labelForCard(type, value),
    };
  }

  function labelForCard(type, value) {
    if (type === "number") return String(value);
    if (type === "plus") return `+${value}`;
    if (type === "double") return "x2";
    if (type === "freeze") return "Freeze";
    if (type === "secondChance") return "Second Chance";
    if (type === "flipThree") return "Flip Three";
    return "Card";
  }

  function createDeck() {
    const cards = [];
    let index = 0;
    cards.push(makeCard("number", 0, index++));
    for (let number = 1; number <= 12; number += 1) {
      for (let copy = 0; copy < number; copy += 1) {
        cards.push(makeCard("number", number, index++));
      }
    }
    [2, 4, 6, 8, 10].forEach((value) => cards.push(makeCard("plus", value, index++)));
    cards.push(makeCard("double", 2, index++));
    ["freeze", "secondChance", "flipThree"].forEach((type) => {
      for (let copy = 0; copy < 3; copy += 1) {
        cards.push(makeCard(type, null, index++));
      }
    });
    return cards;
  }

  function shuffle(cards, rng) {
    const random = rng || Math.random;
    const shuffled = cards.slice();
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const temp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = temp;
    }
    return shuffled;
  }

  function createPlayer(name, index) {
    return {
      id: `p${index + 1}`,
      name: name && name.trim() ? name.trim() : `Player ${index + 1}`,
      totalScore: 0,
      roundScore: 0,
      lastRoundScore: 0,
      status: PLAYER_STATUS.OUT,
      numberCards: [],
      modifierCards: [],
      hasSecondChance: false,
      flip7: false,
      roundNote: "",
    };
  }

  function createGame(names, targetScore, options) {
    const safeNames = names.slice(0, 8);
    const state = {
      version: 1,
      phase: "home",
      players: safeNames.map(createPlayer),
      round: 0,
      targetScore: Number(targetScore) || 200,
      teacherControls: Boolean(options && options.teacherControls),
      deck: shuffle(createDeck()),
      discard: [],
      currentPlayerId: null,
      activePlayerIds: safeNames.map((_, index) => `p${index + 1}`),
      initialDeal: null,
      pendingReveal: null,
      pendingTarget: null,
      flipThree: null,
      actionQueue: [],
      undoState: null,
      log: [],
      lastEvent: "Game ready.",
      roundEndedBy: "",
      tiebreakCandidates: [],
      winnerIds: [],
      gameOverReason: "",
    };
    addLog(state, `New game started. Target score: ${state.targetScore}.`);
    startRound(state, state.activePlayerIds);
    return state;
  }

  function addLog(state, message) {
    const entry = {
      round: state.round || 0,
      message,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    state.log.unshift(entry);
    state.log = state.log.slice(0, 80);
    state.lastEvent = message;
  }

  function getPlayer(state, playerId) {
    return state.players.find((player) => player.id === playerId);
  }

  function activePlayers(state) {
    return state.players.filter(
      (player) => state.activePlayerIds.includes(player.id) && player.status === PLAYER_STATUS.ACTIVE
    );
  }

  function participatingPlayers(state) {
    return state.players.filter((player) => state.activePlayerIds.includes(player.id));
  }

  function resetRoundFields(player, isParticipant) {
    player.roundScore = 0;
    player.lastRoundScore = 0;
    player.status = isParticipant ? PLAYER_STATUS.ACTIVE : PLAYER_STATUS.OUT;
    player.numberCards = [];
    player.modifierCards = [];
    player.hasSecondChance = false;
    player.flip7 = false;
    player.roundNote = "";
  }

  function startRound(state, participantIds) {
    state.round += 1;
    state.activePlayerIds = participantIds && participantIds.length ? participantIds.slice() : state.players.map((p) => p.id);
    state.players.forEach((player) => resetRoundFields(player, state.activePlayerIds.includes(player.id)));
    state.currentPlayerId = state.activePlayerIds[0] || null;
    state.phase = "dealing";
    state.initialDeal = { index: 0 };
    state.pendingReveal = null;
    state.pendingTarget = null;
    state.flipThree = null;
    state.actionQueue = [];
    state.roundEndedBy = "";
    state.tiebreakCandidates = [];
    state.winnerIds = [];
    addLog(state, `Round ${state.round} started.`);
    continueInitialDeal(state);
  }

  function continueInitialDeal(state) {
    if (!state.initialDeal) return;
    while (state.initialDeal.index < state.activePlayerIds.length) {
      const playerId = state.activePlayerIds[state.initialDeal.index];
      const player = getPlayer(state, playerId);
      if (player && player.status === PLAYER_STATUS.ACTIVE) {
        const card = drawCard(state);
        addLog(state, `${player.name} receives starting card ${card.label}.`);
        resolveCard(state, playerId, card, { fromInitialDeal: true });
        if (state.phase === "selectTarget" || isRoundOver(state)) return;
      }
      state.initialDeal.index += 1;
    }
    state.initialDeal = null;
    if (isRoundOver(state)) {
      finalizeRound(state, state.roundEndedBy || "Initial deal ended the round.");
      return;
    }
    state.currentPlayerId = findNextActiveId(state, null);
    state.phase = "pass";
  }

  function drawCard(state) {
    if (!state.deck.length && state.discard.length) {
      state.deck = shuffle(state.discard);
      state.discard = [];
      addLog(state, "Deck was empty. Discard pile reshuffled.");
    }
    if (!state.deck.length) {
      state.deck = shuffle(createDeck());
      addLog(state, "A fresh deck was created because no cards were available.");
    }
    return state.deck.shift();
  }

  function saveUndo(state) {
    const snapshot = cloneState(state);
    snapshot.undoState = null;
    state.undoState = snapshot;
  }

  function undo(state) {
    if (!state.undoState) return state;
    const previous = cloneState(state.undoState);
    previous.undoState = null;
    addLog(previous, "Last action undone.");
    return previous;
  }

  function beginTurn(state) {
    if (state.phase !== "pass") return;
    state.phase = "turn";
    const player = getPlayer(state, state.currentPlayerId);
    if (player) addLog(state, `${player.name}'s turn.`);
  }

  function hit(state) {
    if (state.phase !== "turn") return;
    saveUndo(state);
    const player = getPlayer(state, state.currentPlayerId);
    if (!player || player.status !== PLAYER_STATUS.ACTIVE) {
      advanceTurn(state);
      return;
    }
    const card = drawCard(state);
    addLog(state, `${player.name} hits and draws ${card.label}.`);
    state.holdAfterHit = true;
    resolveCard(state, player.id, card, { fromTurn: true });
    state.holdAfterHit = false;
    pauseForReveal(state, player.id, card);
  }

  function pauseForReveal(state, playerId, card, forcedNextPhase) {
    const nextPhase = forcedNextPhase || (["selectTarget", "roundSummary", "gameOver", "tiebreak"].includes(state.phase)
      ? state.phase
      : "advanceTurn");
    state.pendingReveal = {
      playerId,
      card,
      nextPhase,
      message: state.lastEvent,
    };
    state.phase = "reveal";
  }

  function continueAfterReveal(state) {
    if (state.phase !== "reveal" || !state.pendingReveal) return;
    const nextPhase = state.pendingReveal.nextPhase;
    state.pendingReveal = null;
    if (nextPhase === "advanceTurn") {
      advanceTurn(state);
      return;
    }
    if (nextPhase === "flipThreeContinue") {
      continueFlipThree(state);
      return;
    }
    state.phase = nextPhase;
  }

  function stay(state) {
    if (state.phase !== "turn") return;
    saveUndo(state);
    const player = getPlayer(state, state.currentPlayerId);
    if (!player || player.status !== PLAYER_STATUS.ACTIVE) return;
    player.status = PLAYER_STATUS.STAYED;
    player.roundScore = calculateRoundScore(player);
    player.roundNote = "Stayed";
    addLog(state, `${player.name} stays with ${player.roundScore} points.`);
    advanceTurn(state);
  }

  function resolveCard(state, playerId, card, context) {
    const player = getPlayer(state, playerId);
    if (!player || player.status !== PLAYER_STATUS.ACTIVE) {
      state.discard.push(card);
      return;
    }
    if (card.type === "number") {
      resolveNumberCard(state, player, card);
      return;
    }
    if (card.type === "plus" || card.type === "double") {
      player.modifierCards.push(card);
      player.roundScore = calculateRoundScore(player);
      addLog(state, `${player.name} keeps ${card.label}. Current round score: ${player.roundScore}.`);
      return;
    }
    if (card.type === "secondChance") {
      resolveSecondChance(state, player, card, context || {});
      return;
    }
    if (card.type === "freeze" || card.type === "flipThree") {
      requestTarget(state, card.type, player.id, card, context);
    }
  }

  function resolveNumberCard(state, player, card) {
    const duplicate = player.numberCards.some((existing) => existing.value === card.value);
    if (duplicate && player.hasSecondChance) {
      player.hasSecondChance = false;
      state.discard.push(card);
      player.roundScore = calculateRoundScore(player);
      player.roundNote = "Second Chance saved a bust";
      addLog(state, `${player.name} drew duplicate ${card.value}, but Second Chance saved them.`);
      return;
    }
    if (duplicate) {
      player.status = PLAYER_STATUS.BUSTED;
      player.roundScore = 0;
      player.roundNote = `Busted on ${card.value}`;
      player.hasSecondChance = false;
      state.discard.push(card);
      addLog(state, `${player.name} busted on duplicate ${card.value}.`);
      if (isRoundOver(state)) finalizeRound(state, "All players are out, stayed, frozen, or busted.");
      return;
    }
    player.numberCards.push(card);
    player.roundScore = calculateRoundScore(player);
    addLog(state, `${player.name} keeps ${card.value}. Current round score: ${player.roundScore}.`);
    if (uniqueNumberCount(player) >= 7) {
      player.flip7 = true;
      player.roundNote = "Lucky 7 bonus";
      finalizeRound(state, `${player.name} reached seven different number cards.`);
    }
  }

  function resolveSecondChance(state, player, card, context) {
    if (!player.hasSecondChance) {
      player.hasSecondChance = true;
      state.discard.push(card);
      addLog(state, `${player.name} gains Second Chance.`);
      return;
    }
    const eligible = activePlayers(state).filter((candidate) => candidate.id !== player.id && !candidate.hasSecondChance);
    if (!eligible.length) {
      state.discard.push(card);
      addLog(state, `${player.name} already has Second Chance, so the extra card is discarded.`);
      return;
    }
    if (context && context.fromFlipThree) {
      state.actionQueue.push({
        kind: "secondChanceGift",
        sourcePlayerId: player.id,
        card,
        context: { message: `${player.name} already has Second Chance. Choose who gets the extra one.` },
      });
      addLog(state, `${player.name}'s extra Second Chance is queued until Flip Three finishes.`);
      return;
    }
    state.pendingTarget = {
      kind: "secondChanceGift",
      sourcePlayerId: player.id,
      card,
      message: `${player.name} already has Second Chance. Choose who gets the extra one.`,
    };
    state.phase = "selectTarget";
  }

  function requestTarget(state, kind, sourcePlayerId, card, context) {
    const eligible = targetsForAction(state, kind, sourcePlayerId);
    if (!eligible.length) {
      state.discard.push(card);
      addLog(state, `${labelForActionKind(kind)} was discarded because there was no legal target.`);
      finishActionResolution(state);
      return;
    }
    if (eligible.length === 1) {
      resolveTargetAction(state, eligible[0].id, { kind, sourcePlayerId, card, auto: true, context });
      return;
    }
    state.pendingTarget = {
      kind,
      sourcePlayerId,
      card,
      message: (context && context.message) || `${labelForActionKind(kind)} needs a target.`,
      context: context || {},
    };
    state.phase = "selectTarget";
  }

  function labelForActionKind(kind) {
    if (kind === "freeze") return "Freeze";
    if (kind === "flipThree") return "Flip Three";
    if (kind === "secondChanceGift") return "Second Chance";
    return "Action";
  }

  function legalTargets(state) {
    if (!state.pendingTarget) return [];
    return targetsForAction(state, state.pendingTarget.kind, state.pendingTarget.sourcePlayerId);
  }

  function targetsForAction(state, kind, sourcePlayerId) {
    if (kind === "secondChanceGift") {
      return activePlayers(state).filter((player) => player.id !== sourcePlayerId && !player.hasSecondChance);
    }
    return activePlayers(state);
  }

  function chooseTarget(state, targetId) {
    if (!state.pendingTarget) return;
    saveUndo(state);
    const pending = state.pendingTarget;
    state.pendingTarget = null;
    state.phase = "resolving";
    resolveTargetAction(state, targetId, pending);
  }

  function resolveTargetAction(state, targetId, action) {
    const target = getPlayer(state, targetId);
    const source = getPlayer(state, action.sourcePlayerId);
    if (!target || target.status !== PLAYER_STATUS.ACTIVE) {
      if (action.card) state.discard.push(action.card);
      addLog(state, "Action discarded because there was no legal target.");
      finishActionResolution(state);
      return;
    }

    if (action.kind === "freeze") {
      target.status = PLAYER_STATUS.FROZEN;
      target.roundScore = calculateRoundScore(target);
      target.roundNote = "Frozen";
      target.hasSecondChance = false;
      state.discard.push(action.card);
      addLog(state, `${target.name} is frozen by ${source ? source.name : "an action"} and banks ${target.roundScore} points.`);
      finishActionResolution(state);
      return;
    }

    if (action.kind === "secondChanceGift") {
      target.hasSecondChance = true;
      state.discard.push(action.card);
      addLog(state, `${target.name} receives the extra Second Chance.`);
      finishActionResolution(state);
      return;
    }

    if (action.kind === "flipThree") {
      state.discard.push(action.card);
      addLog(state, `${target.name} must Flip Three.`);
      startFlipThree(state, target.id);
    }
  }

  function startFlipThree(state, targetId) {
    state.flipThree = {
      targetId,
      remaining: 3,
      drawn: 0,
      deferred: [],
    };
    drawNextFlipThreeCard(state);
  }

  function continueFlipThree(state) {
    if (!state.flipThree) {
      finishActionResolution(state);
      return;
    }
    const target = getPlayer(state, state.flipThree.targetId);
    if (!target || target.status !== PLAYER_STATUS.ACTIVE || state.flipThree.remaining <= 0 || isRoundOver(state)) {
      finishFlipThree(state);
      return;
    }
    drawNextFlipThreeCard(state);
  }

  function drawNextFlipThreeCard(state) {
    const sequence = state.flipThree;
    const target = sequence ? getPlayer(state, sequence.targetId) : null;
    if (!sequence || !target || target.status !== PLAYER_STATUS.ACTIVE || sequence.remaining <= 0) {
      finishFlipThree(state);
      return;
    }
    sequence.remaining -= 1;
    sequence.drawn += 1;
    const card = drawCard(state);
    addLog(state, `${target.name} flips ${card.label} (${sequence.drawn}/3).`);
    if (card.type === "freeze" || card.type === "flipThree") {
      sequence.deferred.push({ kind: card.type, sourcePlayerId: target.id, card, context: { fromFlipThree: true } });
      addLog(state, `${card.label} is queued until Flip Three finishes.`);
    } else {
      resolveCard(state, target.id, card, { fromFlipThree: true });
    }
    const nextPhase = ["roundSummary", "gameOver", "tiebreak"].includes(state.phase) || isRoundOver(state)
      ? state.phase
      : "flipThreeContinue";
    pauseForReveal(state, target.id, card, nextPhase);
  }

  function finishFlipThree(state) {
    const sequence = state.flipThree;
    if (!sequence) {
      finishActionResolution(state);
      return;
    }
    const target = getPlayer(state, sequence.targetId);
    if (target && target.status === PLAYER_STATUS.ACTIVE && state.phase !== "roundSummary" && state.phase !== "gameOver") {
      state.actionQueue.push(...sequence.deferred);
    } else {
      sequence.deferred.forEach((item) => state.discard.push(item.card));
      if (sequence.deferred.length && target) addLog(state, `${target.name}'s queued actions were discarded because they are no longer active.`);
    }
    state.flipThree = null;
    finishActionResolution(state);
  }

  function finishActionResolution(state) {
    if (state.phase === "roundSummary" || state.phase === "gameOver" || state.phase === "tiebreak") return;
    if (isRoundOver(state)) {
      finalizeRound(state, "All players are out, stayed, frozen, or busted.");
      return;
    }
    if (state.actionQueue.length) {
      const next = state.actionQueue.shift();
      requestTarget(state, next.kind, next.sourcePlayerId, next.card, next.context);
      return;
    }
    if (state.initialDeal) {
      state.initialDeal.index += 1;
      continueInitialDeal(state);
      return;
    }
    if (state.holdAfterHit) {
      state.phase = "turn";
      return;
    }
    advanceTurn(state);
  }

  function advanceTurn(state) {
    if (state.phase === "selectTarget" || state.phase === "roundSummary" || state.phase === "gameOver" || state.phase === "tiebreak") return;
    if (isRoundOver(state)) {
      finalizeRound(state, "All players are out, stayed, frozen, or busted.");
      return;
    }
    state.currentPlayerId = findNextActiveId(state, state.currentPlayerId);
    state.phase = "pass";
  }

  function findNextActiveId(state, afterPlayerId) {
    const ids = state.activePlayerIds;
    if (!ids.length) return null;
    let start = afterPlayerId ? ids.indexOf(afterPlayerId) + 1 : 0;
    if (start < 0) start = 0;
    for (let offset = 0; offset < ids.length; offset += 1) {
      const id = ids[(start + offset) % ids.length];
      const player = getPlayer(state, id);
      if (player && player.status === PLAYER_STATUS.ACTIVE) return id;
    }
    return null;
  }

  function uniqueNumberCount(player) {
    return new Set(player.numberCards.map((card) => card.value)).size;
  }

  function calculateRoundScore(player) {
    if (player.status === PLAYER_STATUS.BUSTED) return 0;
    const numberTotal = player.numberCards.reduce((sum, card) => sum + Number(card.value || 0), 0);
    const hasDouble = player.modifierCards.some((card) => card.type === "double");
    const plusTotal = player.modifierCards
      .filter((card) => card.type === "plus")
      .reduce((sum, card) => sum + Number(card.value || 0), 0);
    return (hasDouble ? numberTotal * 2 : numberTotal) + plusTotal + (player.flip7 ? 15 : 0);
  }

  function isRoundOver(state) {
    if (state.phase === "roundSummary" || state.phase === "gameOver" || state.phase === "tiebreak") return true;
    if (participatingPlayers(state).some((player) => player.flip7)) return true;
    return activePlayers(state).length === 0;
  }

  function finalizeRound(state, reason) {
    state.roundEndedBy = reason;
    participatingPlayers(state).forEach((player) => {
      player.lastRoundScore = calculateRoundScore(player);
      player.roundScore = player.lastRoundScore;
      player.totalScore += player.lastRoundScore;
      player.hasSecondChance = false;
      player.numberCards.forEach((card) => state.discard.push(card));
      player.modifierCards.forEach((card) => state.discard.push(card));
    });
    state.currentPlayerId = null;
    state.pendingTarget = null;
    state.actionQueue = [];
    addLog(state, `Round ${state.round} ended. ${reason}`);
    const reached = state.players.filter((player) => player.totalScore >= state.targetScore);
    if (reached.length) {
      const highest = Math.max(...state.players.map((player) => player.totalScore));
      const leaders = state.players.filter((player) => player.totalScore === highest);
      if (leaders.length === 1) {
        state.winnerIds = [leaders[0].id];
        state.gameOverReason = `${leaders[0].name} wins with ${leaders[0].totalScore} points.`;
        state.phase = "gameOver";
        addLog(state, state.gameOverReason);
      } else {
        state.tiebreakCandidates = leaders.map((player) => player.id);
        state.phase = "tiebreak";
        addLog(state, `Tie at ${highest}. Tiebreak round needed.`);
      }
      return;
    }
    state.phase = "roundSummary";
  }

  function startNextRound(state) {
    if (state.phase !== "roundSummary") return;
    saveUndo(state);
    startRound(state, state.players.map((player) => player.id));
  }

  function startTiebreak(state) {
    if (state.phase !== "tiebreak") return;
    saveUndo(state);
    const candidates = state.tiebreakCandidates.slice();
    startRound(state, candidates);
  }

  function teacherEndRound(state) {
    if (!state.teacherControls) return;
    saveUndo(state);
    finalizeRound(state, "Teacher ended the round.");
  }

  function setPlayerScore(state, playerId, score) {
    if (!state.teacherControls) return;
    const player = getPlayer(state, playerId);
    if (!player) return;
    saveUndo(state);
    player.totalScore = Math.max(0, Number(score) || 0);
    addLog(state, `${player.name}'s total score was set to ${player.totalScore}.`);
  }

  function samePlayersNewGame(state) {
    return createGame(
      state.players.map((player) => player.name),
      state.targetScore,
      { teacherControls: state.teacherControls }
    );
  }

  const api = {
    STORAGE_KEY,
    PLAYER_STATUS,
    createDeck,
    shuffle,
    createGame,
    beginTurn,
    hit,
    continueAfterReveal,
    stay,
    chooseTarget,
    legalTargets,
    startNextRound,
    startTiebreak,
    undo,
    teacherEndRound,
    setPlayerScore,
    samePlayersNewGame,
    calculateRoundScore,
    cloneState,
    getPlayer,
    addLog,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.Lucky7Core = api;
})(typeof window !== "undefined" ? window : globalThis);
