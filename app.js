(function () {
  "use strict";

  const Core = window.Lucky7Core;
  const app = document.getElementById("app");
  let state = loadState();
  let setup = {
    count: 4,
    names: ["Ada", "Ben", "Chloe", "Derek", "Player 5", "Player 6", "Player 7", "Player 8"],
    target: 200,
    customTarget: 150,
    teacherControls: true,
  };
  let view = state ? state.phase : "home";
  let scoreEditorOpen = false;

  function saveState() {
    if (!state) return;
    localStorage.setItem(Core.STORAGE_KEY, JSON.stringify(state));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(Core.STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function clearSavedState() {
    localStorage.removeItem(Core.STORAGE_KEY);
  }

  function html(strings, ...values) {
    return strings.reduce((result, part, index) => result + part + (values[index] ?? ""), "");
  }

  function escapeText(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function render() {
    if (state) {
      view = state.phase;
      saveState();
    }
    const content = state ? renderGameView() : renderSetupView();
    app.innerHTML = content;
    bindEvents();
  }

  function renderSetupView() {
    if (view === "setup") return renderPlayerSetup();
    if (view === "target") return renderTargetSetup();
    if (view === "rules") return renderRules();
    return renderHome();
  }

  function renderHome() {
    return html`
      <main class="home-screen">
        <section class="hero">
          <div class="brand-row">
            <span class="brand-mark">7</span>
            <span class="pill">Classroom pass-and-play</span>
          </div>
          <h1>Lucky 7 Classroom</h1>
          <p>Private classroom game inspired by press-your-luck card play. No official art, no login, one shared device.</p>
          <div class="hero-actions">
            <button class="primary big" data-action="go-setup">Start</button>
            <button class="secondary big" data-action="continue" ${state || loadState() ? "" : "disabled"}>Continue Last Game</button>
          </div>
          <button class="text-button" data-action="rules">Rules Summary</button>
        </section>
      </main>
    `;
  }

  function renderPlayerSetup() {
    const rows = Array.from({ length: setup.count }, (_, index) => {
      return html`
        <label class="field player-name">
          <span>Player ${index + 1}</span>
          <input data-name-index="${index}" value="${escapeText(setup.names[index] || `Player ${index + 1}`)}" />
        </label>
      `;
    }).join("");
    return html`
      <main class="setup-screen">
        <header class="screen-header">
          <button class="icon-button" data-action="home" aria-label="Back">‹</button>
          <div>
            <p class="eyebrow">Setup</p>
            <h1>Players</h1>
          </div>
        </header>
        <section class="panel">
          <label class="field">
            <span>Number of players</span>
            <select data-action="player-count">
              ${[3, 4, 5, 6, 7, 8].map((count) => `<option value="${count}" ${setup.count === count ? "selected" : ""}>${count}</option>`).join("")}
            </select>
          </label>
          <div class="name-grid">${rows}</div>
          <div class="button-row">
            <button class="secondary" data-action="random-names">Random Names</button>
            <button class="secondary" data-action="reset-names">Reset Names</button>
          </div>
          <button class="primary wide" data-action="go-target">Next</button>
        </section>
      </main>
    `;
  }

  function renderTargetSetup() {
    const targetOptions = [100, 200, "custom"].map((target) => {
      const selected = setup.target === target;
      const label = target === 100 ? "Short 100" : target === 200 ? "Standard 200" : "Custom";
      return `<button class="choice ${selected ? "selected" : ""}" data-target="${target}">${label}</button>`;
    }).join("");
    return html`
      <main class="setup-screen">
        <header class="screen-header">
          <button class="icon-button" data-action="go-setup" aria-label="Back">‹</button>
          <div>
            <p class="eyebrow">Setup</p>
            <h1>Target Score</h1>
          </div>
        </header>
        <section class="panel">
          <div class="choice-grid">${targetOptions}</div>
          <label class="field ${setup.target === "custom" ? "" : "muted"}">
            <span>Custom target</span>
            <input type="number" min="30" max="999" data-action="custom-target" value="${setup.customTarget}" ${setup.target === "custom" ? "" : "disabled"} />
          </label>
          <label class="toggle">
            <input type="checkbox" data-action="teacher-controls" ${setup.teacherControls ? "checked" : ""} />
            <span>Teacher controls</span>
          </label>
          <button class="primary wide" data-action="start-game">Start Game</button>
        </section>
      </main>
    `;
  }

  function renderRules() {
    return html`
      <main class="setup-screen">
        <header class="screen-header">
          <button class="icon-button" data-action="home" aria-label="Back">‹</button>
          <div>
            <p class="eyebrow">Quick rules</p>
            <h1>How It Works</h1>
          </div>
        </header>
        <section class="panel rules-list">
          <p>Hit to draw. Stay to bank your round score. Duplicate number = bust, unless Second Chance saves you.</p>
          <p>Number cards score their value. x2 doubles number total first, then + cards add after.</p>
          <p>Freeze banks a target's score and removes them from the round. Flip Three forces a target to take up to three cards.</p>
          <p>Seven different number cards ends the round immediately and gives that player +15.</p>
          <button class="primary wide" data-action="go-setup">Start Setup</button>
        </section>
      </main>
    `;
  }

  function renderGameView() {
    if (state.phase === "pass") return renderPassScreen();
    if (state.phase === "turn") return renderMainGame();
    if (state.phase === "reveal") return renderRevealScreen();
    if (state.phase === "selectTarget") return renderTargetPicker();
    if (state.phase === "roundSummary") return renderRoundSummary();
    if (state.phase === "tiebreak") return renderTiebreak();
    if (state.phase === "gameOver") return renderGameOver();
    return renderMainGame();
  }

  function renderTopBar() {
    return html`
      <header class="game-topbar">
        <div>
          <p class="eyebrow">Round ${state.round}</p>
          <h1>${escapeText(currentPlayer()?.name || "Lucky 7")}</h1>
        </div>
        <div class="deck-pill">
          <span>${state.deck.length}</span>
          <small>cards left</small>
        </div>
      </header>
    `;
  }

  function renderPassScreen() {
    const player = currentPlayer();
    return html`
      <main class="game-screen">
        ${renderTopBar()}
        ${renderScoreboard()}
        <section class="pass-panel">
          <p class="eyebrow">Pass device</p>
          <h2>${escapeText(player?.name || "Next player")}</h2>
          <p>輪到你。睇清楚名先按，唔好幫隔離位抽爆牌。</p>
          <button class="primary huge" data-action="begin-turn">Ready</button>
        </section>
        ${renderPublicHands()}
        ${renderUtilityBar()}
      </main>
    `;
  }

  function renderMainGame() {
    return html`
      <main class="game-screen">
        ${renderTopBar()}
        ${renderScoreboard()}
        ${renderCurrentPlayerPanel()}
        <section class="action-dock">
          <button class="hit-button" data-action="hit">Hit</button>
          <button class="stay-button" data-action="stay">Stay</button>
        </section>
        ${renderPublicHands()}
        ${renderUtilityBar()}
        ${renderTeacherPanel()}
      </main>
    `;
  }

  function renderScoreboard() {
    const rows = state.players
      .slice()
      .sort((a, b) => b.totalScore - a.totalScore)
      .map((player) => {
        const isCurrent = player.id === state.currentPlayerId;
        return html`
          <div class="score-chip ${isCurrent ? "current" : ""}">
            <span>${escapeText(player.name)}</span>
            <strong>${player.totalScore}</strong>
          </div>
        `;
      })
      .join("");
    return `<section class="scoreboard">${rows}</section>`;
  }

  function renderCurrentPlayerPanel() {
    const player = currentPlayer();
    if (!player) return "";
    return html`
      <section class="player-stage">
        <div class="status-row">
          <span class="status ${player.status.toLowerCase()}">${player.status}</span>
          <span>Round score <strong>${player.roundScore}</strong></span>
          ${player.hasSecondChance ? `<span class="second-chance">Second Chance</span>` : ""}
        </div>
        <div class="event-box">${escapeText(state.lastEvent)}</div>
      </section>
    `;
  }

  function renderPublicHands() {
    const rows = state.players
      .slice()
      .sort((a, b) => {
        if (a.id === state.currentPlayerId) return -1;
        if (b.id === state.currentPlayerId) return 1;
        return state.players.indexOf(a) - state.players.indexOf(b);
      })
      .map((player) => {
        const isCurrent = player.id === state.currentPlayerId;
        return html`
          <article class="public-hand ${isCurrent ? "current" : ""} ${player.status.toLowerCase()}">
            <header>
              <div>
                <strong>${escapeText(player.name)}</strong>
                <span>${player.status} · round ${player.roundScore}</span>
              </div>
              ${player.hasSecondChance ? `<span class="mini-badge">2nd</span>` : ""}
            </header>
            <div class="cards-section number-section">
              <p class="section-label">Numbers ${player.numberCards.length}/7</p>
              <div class="card-row compact">${renderCards(player.numberCards)}</div>
            </div>
            <div class="cards-section score-section">
              <p class="section-label">Score cards</p>
              <div class="card-row compact">${renderCards(player.modifierCards)}</div>
            </div>
          </article>
        `;
      })
      .join("");
    return html`
      <section class="hands-board">
        <div class="board-title">
          <p class="eyebrow">Open table</p>
          <h2>All Hands Are Public</h2>
        </div>
        <div class="hands-grid">${rows}</div>
      </section>
    `;
  }

  function renderRevealScreen() {
    const reveal = state.pendingReveal;
    const player = reveal ? Core.getPlayer(state, reveal.playerId) : currentPlayer();
    const card = reveal?.card;
    const flipText = state.flipThree ? `Flip Three ${state.flipThree.drawn}/3` : `${player?.name || "Player"} drew`;
    const cardFace = renderDrawnCard(card);
    return html`
      <main class="game-screen">
        ${renderTopBar()}
        ${renderScoreboard()}
        <section class="reveal-panel">
          <p class="eyebrow">${escapeText(flipText)}</p>
          ${cardFace}
          <p>${escapeText(reveal?.message || state.lastEvent)}</p>
          <button class="primary huge" data-action="continue-reveal">Continue</button>
        </section>
        ${renderPublicHands()}
        ${renderUtilityBar()}
      </main>
    `;
  }

  function renderDrawnCard(card) {
    const type = card?.type || "";
    const label = card?.label || "Card";
    const isAction = ["freeze", "secondChance", "flipThree"].includes(type);
    if (!isAction) {
      return html`
        <div class="drawn-card ${cardClass(card)}">
          <span class="card-corner">${escapeText(cardCorner(card))}</span>
          <strong class="card-value">${escapeText(label)}</strong>
          <span class="card-name">${escapeText(cardName(card))}</span>
        </div>
      `;
    }
    const code = type === "freeze" ? "STOP" : type === "secondChance" ? "SAVE" : "THREE";
    return html`
      <div class="drawn-card action-card ${cardClass(card)}">
        <span class="action-code">${code}</span>
        <strong class="card-value">${escapeText(label)}</strong>
        <span class="card-name">${escapeText(cardName(card))}</span>
      </div>
    `;
  }

  function renderCards(cards) {
    if (!cards.length) return `<span class="empty-cards">No cards yet</span>`;
    return cards
      .map(
        (card) => html`
          <span class="card ${cardClass(card)}">
            <span class="card-corner">${escapeText(cardCorner(card))}</span>
            <strong class="card-value">${escapeText(card.label)}</strong>
            <span class="card-name">${escapeText(cardName(card))}</span>
          </span>
        `
      )
      .join("");
  }

  function cardClass(card) {
    if (!card) return "";
    const accent = card.type === "number" ? `accent-${Number(card.value || 0) % 6}` : "";
    return `${card.type || ""} ${accent}`;
  }

  function cardCorner(card) {
    if (!card) return "";
    if (card.type === "number") return `No. ${card.value}`;
    if (card.type === "plus") return "Bonus";
    if (card.type === "double") return "Double";
    if (card.type === "freeze") return "Action";
    if (card.type === "flipThree") return "Action";
    if (card.type === "secondChance") return "Action";
    return "";
  }

  function cardName(card) {
    if (!card) return "";
    if (card.type === "number") {
      const names = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
      return names[Number(card.value)] || "Number";
    }
    if (card.type === "plus") return `Bonus ${card.value}`;
    if (card.type === "double") return "Double score";
    if (card.type === "freeze") return "Freeze";
    if (card.type === "flipThree") return "Flip three";
    if (card.type === "secondChance") return "Second chance";
    return card.label || "";
  }

  function renderTargetPicker() {
    const targets = Core.legalTargets(state);
    const pending = state.pendingTarget;
    const buttons = targets
      .map((player) => {
        return html`
          <button class="target-button" data-target-player="${player.id}">
            <strong>${escapeText(player.name)}</strong>
            <span>${player.roundScore} round pts · ${player.status}</span>
          </button>
        `;
      })
      .join("");
    return html`
      <main class="game-screen">
        ${renderTopBar()}
        ${renderScoreboard()}
        <section class="target-panel">
          <p class="eyebrow">Choose target</p>
          <h2>${escapeText(pending?.message || "Select a player")}</h2>
          <div class="target-grid">${buttons}</div>
        </section>
        ${renderPublicHands()}
        ${renderUtilityBar()}
      </main>
    `;
  }

  function renderRoundSummary() {
    const rows = state.players.map((player) => renderSummaryRow(player)).join("");
    return html`
      <main class="game-screen">
        <header class="screen-header">
          <div>
            <p class="eyebrow">Round ${state.round} complete</p>
            <h1>Round Summary</h1>
          </div>
        </header>
        <section class="summary-panel">
          <p>${escapeText(state.roundEndedBy || "Round ended.")}</p>
          <div class="summary-list">${rows}</div>
          <button class="primary wide" data-action="next-round">Next Round</button>
        </section>
        ${renderUtilityBar()}
      </main>
    `;
  }

  function renderSummaryRow(player) {
    const note = player.roundNote || player.status;
    return html`
      <div class="summary-row">
        <div>
          <strong>${escapeText(player.name)}</strong>
          <span>${escapeText(note)}</span>
        </div>
        <div class="summary-score">
          <span>+${player.lastRoundScore}</span>
          <strong>${player.totalScore}</strong>
        </div>
      </div>
    `;
  }

  function renderTiebreak() {
    const names = state.tiebreakCandidates.map((id) => Core.getPlayer(state, id)?.name).filter(Boolean).join(", ");
    return html`
      <main class="game-screen">
        <section class="pass-panel">
          <p class="eyebrow">Tiebreak needed</p>
          <h2>${escapeText(names)}</h2>
          <p>最高分打和。只限平手玩家再玩一 round，唔關事嘅同學可以暫時食花生。</p>
          <button class="primary huge" data-action="start-tiebreak">Start Tiebreak</button>
        </section>
        ${renderUtilityBar()}
      </main>
    `;
  }

  function renderGameOver() {
    const winners = state.winnerIds.map((id) => Core.getPlayer(state, id)).filter(Boolean);
    const winnerText = winners.map((player) => player.name).join(", ");
    return html`
      <main class="home-screen">
        <section class="hero end-hero">
          <p class="eyebrow">Game over</p>
          <h1>${escapeText(winnerText)} wins</h1>
          <p>${escapeText(state.gameOverReason)}</p>
          ${renderScoreboard()}
          <div class="hero-actions">
            <button class="primary big" data-action="same-players">Same Players Again</button>
            <button class="secondary big" data-action="new-game">New Game</button>
          </div>
          <button class="text-button" data-action="show-log">View Game Log</button>
        </section>
      </main>
    `;
  }

  function renderUtilityBar() {
    return html`
      <nav class="utility-bar">
        <button data-action="undo" ${state?.undoState ? "" : "disabled"}>Undo</button>
        <button data-action="show-log">Log</button>
        <button data-action="show-rules">Rules</button>
        <button data-action="new-game">New Game</button>
      </nav>
    `;
  }

  function renderTeacherPanel() {
    if (!state.teacherControls) return "";
    const editor = scoreEditorOpen
      ? html`
          <div class="score-editor">
            ${state.players
              .map(
                (player) => html`
                  <label>
                    <span>${escapeText(player.name)}</span>
                    <input type="number" min="0" value="${player.totalScore}" data-score-player="${player.id}" />
                  </label>
                `
              )
              .join("")}
          </div>
        `
      : "";
    return html`
      <section class="teacher-panel">
        <div class="teacher-actions">
          <button class="secondary" data-action="teacher-end-round">End Round</button>
          <button class="secondary" data-action="toggle-score-editor">${scoreEditorOpen ? "Close Scores" : "Edit Scores"}</button>
        </div>
        ${editor}
      </section>
    `;
  }

  function showModal(title, body) {
    app.insertAdjacentHTML(
      "beforeend",
      html`
        <div class="modal-backdrop" data-action="close-modal">
          <section class="modal" role="dialog" aria-modal="true">
            <h2>${escapeText(title)}</h2>
            <div>${body}</div>
            <button class="primary wide" data-action="close-modal">Close</button>
          </section>
        </div>
      `
    );
  }

  function currentPlayer() {
    if (!state) return null;
    return Core.getPlayer(state, state.currentPlayerId);
  }

  function bindEvents() {
    app.querySelectorAll("[data-action]").forEach((element) => {
      element.addEventListener("click", handleAction);
      element.addEventListener("change", handleAction);
      element.addEventListener("input", handleAction);
    });
    app.querySelectorAll("[data-name-index]").forEach((input) => {
      input.addEventListener("input", (event) => {
        setup.names[Number(event.target.dataset.nameIndex)] = event.target.value;
      });
    });
    app.querySelectorAll("[data-target]").forEach((button) => {
      button.addEventListener("click", () => {
        setup.target = button.dataset.target === "custom" ? "custom" : Number(button.dataset.target);
        render();
      });
    });
    app.querySelectorAll("[data-target-player]").forEach((button) => {
      button.addEventListener("click", () => {
        Core.chooseTarget(state, button.dataset.targetPlayer);
        render();
      });
    });
    app.querySelectorAll("[data-score-player]").forEach((input) => {
      input.addEventListener("change", (event) => {
        Core.setPlayerScore(state, event.target.dataset.scorePlayer, event.target.value);
        render();
      });
    });
  }

  function handleAction(event) {
    const action = event.currentTarget.dataset.action;
    if (event.type === "input" && action !== "custom-target") return;
    if (event.type === "change" && !["player-count", "teacher-controls"].includes(action)) return;
    if (event.type === "click" && ["player-count", "teacher-controls", "custom-target"].includes(action)) return;

    if (action === "home") {
      view = "home";
      state = null;
      render();
    }
    if (action === "go-setup") {
      view = "setup";
      state = null;
      render();
    }
    if (action === "go-target") {
      view = "target";
      render();
    }
    if (action === "rules" || action === "show-rules") {
      if (state) {
        showModal("Rules Summary", renderRulesBody());
      } else {
        view = "rules";
        render();
      }
    }
    if (action === "continue") {
      state = loadState();
      render();
    }
    if (action === "player-count") {
      setup.count = Number(event.currentTarget.value);
      render();
    }
    if (action === "random-names") {
      setup.names = ["Newton", "Gauss", "Ada", "Hypatia", "Noether", "Euler", "Turing", "Emmy"];
      render();
    }
    if (action === "reset-names") {
      setup.names = Array.from({ length: 8 }, (_, index) => `Player ${index + 1}`);
      render();
    }
    if (action === "custom-target") {
      setup.customTarget = Number(event.currentTarget.value);
    }
    if (action === "teacher-controls") {
      setup.teacherControls = event.currentTarget.checked;
    }
    if (action === "start-game") {
      const target = setup.target === "custom" ? setup.customTarget : setup.target;
      const names = setup.names.slice(0, setup.count);
      state = Core.createGame(names, target, { teacherControls: setup.teacherControls });
      scoreEditorOpen = false;
      render();
    }
    if (action === "begin-turn") {
      Core.beginTurn(state);
      render();
    }
    if (action === "hit") {
      Core.hit(state);
      render();
    }
    if (action === "continue-reveal") {
      Core.continueAfterReveal(state);
      render();
    }
    if (action === "stay") {
      Core.stay(state);
      render();
    }
    if (action === "undo") {
      state = Core.undo(state);
      render();
    }
    if (action === "next-round") {
      Core.startNextRound(state);
      scoreEditorOpen = false;
      render();
    }
    if (action === "start-tiebreak") {
      Core.startTiebreak(state);
      render();
    }
    if (action === "teacher-end-round") {
      Core.teacherEndRound(state);
      render();
    }
    if (action === "toggle-score-editor") {
      scoreEditorOpen = !scoreEditorOpen;
      render();
    }
    if (action === "show-log") {
      showModal("Game Log", renderLogBody());
    }
    if (action === "new-game") {
      if (confirm("Start a new game? Current progress will be cleared.")) {
        clearSavedState();
        state = null;
        view = "setup";
        render();
      }
    }
    if (action === "same-players") {
      state = Core.samePlayersNewGame(state);
      render();
    }
    if (action === "close-modal") {
      render();
    }
  }

  function renderRulesBody() {
    return html`
      <div class="rules-list">
        <p>Hit draws one card. Stay banks your current round score.</p>
        <p>Duplicate number means bust unless Second Chance removes that duplicate.</p>
        <p>Freeze banks a target. Flip Three forces up to three cards. Seven unique number cards gives +15 and ends the round.</p>
      </div>
    `;
  }

  function renderLogBody() {
    const entries = (state?.log || [])
      .map((entry) => `<li><span>R${entry.round}</span> ${escapeText(entry.message)}</li>`)
      .join("");
    return `<ol class="log-list">${entries || "<li>No events yet.</li>"}</ol>`;
  }

  render();
})();
