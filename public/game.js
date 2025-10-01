// Game page functionality
const socket = io();

// DOM elements
const sessionDisplay = document.getElementById('sessionDisplay');
const playerCount = document.getElementById('playerCount');
const playersList = document.getElementById('playersList');
const scoreboard = document.getElementById('scoreboard');
const messages = document.getElementById('messages');
const gameControls = document.getElementById('gameControls');
const guessControls = document.getElementById('guessControls');
const leaveGameBtn = document.getElementById('leaveGame');

// Game controls
const questionInput = document.getElementById('questionInput');
const answerInput = document.getElementById('answerInput');
const startGameBtn = document.getElementById('startGame');

// Guess controls
const questionDisplay = document.getElementById('questionDisplay');
const attemptsDisplay = document.getElementById('attemptsDisplay');
const timerDisplay = document.getElementById('timerDisplay');
const guessInput = document.getElementById('guessInput');
const submitGuessBtn = document.getElementById('submitGuess');

// Chat
const chatInput = document.getElementById('chatInput');
const sendMessageBtn = document.getElementById('sendMessage');
const resetDataBtn = document.getElementById('resetData');

// Game state
let currentSessionId = '';
let isGameMaster = false;
let gameTimer = null;

// Event listeners
startGameBtn.addEventListener('click', startGame);
submitGuessBtn.addEventListener('click', submitGuess);
sendMessageBtn.addEventListener('click', sendChatMessage);
leaveGameBtn.addEventListener('click', leaveGame);

// Handle Enter key
questionInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    answerInput.focus();
  }
});

answerInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    startGame();
  }
});

guessInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    submitGuess();
  }
});

chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendChatMessage();
  }
});

// Functions
function startGame() {
  const question = questionInput.value.trim();
  const answer = answerInput.value.trim();
  
  if (!question || !answer) {
    addMessage('Please enter both question and answer', 'error');
    return;
  }
  
  socket.emit('start-game', { question, answer });
  questionInput.value = '';
  answerInput.value = '';
}

function submitGuess() {
  const guess = guessInput.value.trim();
  
  if (!guess) {
    addMessage('Please enter a guess', 'error');
    return;
  }
  
  socket.emit('submit-guess', guess);
  guessInput.value = '';
}

function sendChatMessage() {
  const message = chatInput.value.trim();
  
  if (!message) return;
  
  socket.emit('chat-message', message);
  chatInput.value = '';
}

function leaveGame() {
  localStorage.removeItem('playerName');
  localStorage.removeItem('sessionId');
  window.location.href = 'index.html';
}

function resetData() {
  localStorage.clear();
  location.reload();
}

function updatePlayersList(players) {
  playersList.innerHTML = '';
  players.forEach(player => {
    const playerDiv = document.createElement('div');
    playerDiv.className = `player-item ${player.isGameMaster ? 'master' : ''}`;
    playerDiv.innerHTML = `
      <span>${player.name}</span>
      ${player.isGameMaster ? '<span>👑</span>' : ''}
    `;
    playersList.appendChild(playerDiv);
  });
}

function updateScoreboard(players) {
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
  scoreboard.innerHTML = '';
  
  sortedPlayers.forEach((player, index) => {
    const scoreDiv = document.createElement('div');
    scoreDiv.className = 'score-item';
    scoreDiv.innerHTML = `
      <span>${index + 1}. ${player.name}</span>
      <span>${player.score} pts</span>
    `;
    scoreboard.appendChild(scoreDiv);
  });
}

function updateGameControls(gameState, isMaster) {
  if (gameState === 'waiting' && isMaster) {
    gameControls.classList.remove('hidden');
    guessControls.classList.add('hidden');
  } else if (gameState === 'active' && !isMaster) {
    gameControls.classList.add('hidden');
    guessControls.classList.remove('hidden');
  } else {
    gameControls.classList.add('hidden');
    guessControls.classList.add('hidden');
  }
}

function addMessage(message, type = 'system', playerName = '') {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  
  if (playerName) {
    messageDiv.innerHTML = `
      <div class="message-header">${playerName}</div>
      <div>${message}</div>
    `;
  } else {
    messageDiv.textContent = message;
  }
  
  messages.appendChild(messageDiv);
  messages.scrollTop = messages.scrollHeight;
}

function startGameTimer(seconds) {
  let timeLeft = seconds;
  timerDisplay.textContent = `Time left: ${timeLeft}s`;
  
  gameTimer = setInterval(() => {
    timeLeft--;
    timerDisplay.textContent = `Time left: ${timeLeft}s`;
    
    if (timeLeft <= 0) {
      clearInterval(gameTimer);
    }
  }, 1000);
}

function stopGameTimer() {
  if (gameTimer) {
    clearInterval(gameTimer);
    gameTimer = null;
  }
}

// Socket event listeners
socket.on('connect', () => {
  const savedPlayerName = localStorage.getItem('playerName');
  const savedSessionId = localStorage.getItem('sessionId');
  
  console.log('=== GAME.JS CONNECT ===');
  console.log('Saved player name:', savedPlayerName);
  console.log('Saved session ID:', savedSessionId);
  
  if (savedPlayerName && savedSessionId) {
    console.log('Attempting to rejoin session:', savedSessionId, 'as', savedPlayerName);
    socket.emit('join-session', { 
      sessionId: savedSessionId, 
      playerName: savedPlayerName 
    });
  } else {
    console.log('No saved session data, redirecting to home');
    window.location.href = 'index.html';
  }
});

socket.on('game-state', (data) => {
  console.log('Received game state:', data);
  sessionDisplay.textContent = data.sessionId;
  currentSessionId = data.sessionId;
  localStorage.setItem('sessionId', data.sessionId);
  
  playerCount.textContent = data.players.length;
  updatePlayersList(data.players);
  updateScoreboard(data.players);
  
  const currentPlayer = data.players.find(p => p.id === socket.id);
  isGameMaster = currentPlayer ? currentPlayer.isGameMaster : false;
  
  updateGameControls(data.gameState, isGameMaster);
});

socket.on('player-joined', (data) => {
  addMessage(`${data.playerName} joined the game (${data.playerCount} players)`, 'system');
});

socket.on('player-left', (data) => {
  addMessage(`${data.playerName} left the game (${data.playerCount} players)`, 'system');
});

socket.on('new-game-master', (data) => {
  addMessage(`${data.newMasterName} is now the game master`, 'system');
});

socket.on('game-started', (data) => {
  questionDisplay.textContent = data.question;
  attemptsDisplay.textContent = 'Attempts left: 3';
  startGameTimer(data.timeLimit);
  addMessage(`Game started! Question: "${data.question}"`, 'system');
  
  // Update controls to show guess interface for non-game masters
  updateScoreboard(data.players);
  const currentPlayer = data.players.find(p => p.id === socket.id);
  isGameMaster = currentPlayer ? currentPlayer.isGameMaster : false;
  updateGameControls('active', isGameMaster);
});

socket.on('game-ended', (data) => {
  stopGameTimer();
  
  // Re-enable guess controls for next game
  submitGuessBtn.disabled = false;
  guessInput.disabled = false;
  
  if (data.reason === 'correct' && data.winner) {
    if (data.winner.id === socket.id) {
      addMessage('🎉 You won! +10 points', 'success');
    } else {
      addMessage(`🎉 ${data.winner.name} won! Answer: "${data.correctAnswer}"`, 'system');
    }
  } else if (data.reason === 'timeout') {
    addMessage(`⏰ Time's up! Answer: "${data.correctAnswer}"`, 'system');
  }
  
  updateScoreboard(data.players);
});

socket.on('player-message', (data) => {
  if (data.type === 'guess') {
    addMessage(`${data.message} (Attempt ${data.attempts}/3)`, 'guess', data.playerName);
  } else {
    addMessage(data.message, 'chat', data.playerName);
  }
});

socket.on('system-message', (data) => {
  addMessage(data.message, data.type);
});

socket.on('guess-result', (data) => {
  if (!data.correct) {
    attemptsDisplay.textContent = `Attempts left: ${data.attemptsLeft}`;
    if (data.attemptsLeft === 0) {
      submitGuessBtn.disabled = true;
      guessInput.disabled = true;
    }
  }
});

socket.on('error', (message) => {
  addMessage(message, 'error');
});

socket.on('disconnect', () => {
  addMessage('Connection lost. Trying to reconnect...', 'error');
});
