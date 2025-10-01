// Home page functionality
const socket = io();

// DOM elements
const playerNameInput = document.getElementById('playerName');
const createSessionBtn = document.getElementById('createSession');
const joinSessionBtn = document.getElementById('joinSession');
const joinForm = document.getElementById('joinForm');
const sessionIdInput = document.getElementById('sessionId');
const joinGameBtn = document.getElementById('joinGame');
const cancelJoinBtn = document.getElementById('cancelJoin');
const errorMessage = document.getElementById('errorMessage');

// Event listeners
createSessionBtn.addEventListener('click', createSession);
joinSessionBtn.addEventListener('click', showJoinForm);
joinGameBtn.addEventListener('click', joinSession);
cancelJoinBtn.addEventListener('click', hideJoinForm);

// Handle Enter key
playerNameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    createSession();
  }
});

sessionIdInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    joinSession();
  }
});

// Functions
function createSession() {
  const playerName = playerNameInput.value.trim();
  
  if (!playerName) {
    showError('Please enter your name');
    return;
  }
  
  if (playerName.length > 20) {
    showError('Name must be 20 characters or less');
    return;
  }
  
  socket.emit('create-session', playerName);
}

function showJoinForm() {
  const playerName = playerNameInput.value.trim();
  
  if (!playerName) {
    showError('Please enter your name first');
    return;
  }
  
  if (playerName.length > 20) {
    showError('Name must be 20 characters or less');
    return;
  }
  
  joinForm.classList.remove('hidden');
  createSessionBtn.disabled = true;
  joinSessionBtn.disabled = true;
  sessionIdInput.focus();
}

function hideJoinForm() {
  joinForm.classList.add('hidden');
  createSessionBtn.disabled = false;
  joinSessionBtn.disabled = false;
  sessionIdInput.value = '';
}

function joinSession() {
  const playerName = playerNameInput.value.trim();
  const sessionId = sessionIdInput.value.trim().toUpperCase();
  
  if (!sessionId) {
    showError('Please enter session ID');
    return;
  }
  
  if (sessionId.length !== 6) {
    showError('Session ID must be 6 characters');
    return;
  }
  
  socket.emit('join-session', { sessionId, playerName });
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.remove('hidden');
  setTimeout(() => {
    errorMessage.classList.add('hidden');
  }, 3000);
}

function resetData() {
  localStorage.clear();
  location.reload();
}

// Socket event listeners
socket.on('session-created', (data) => {
  localStorage.setItem('playerName', data.playerName);
  localStorage.setItem('sessionId', data.sessionId);
  window.location.href = 'game.html';
});

socket.on('error', (message) => {
  showError(message);
  hideJoinForm();
});

// Auto-join if coming back to the page
socket.on('connect', () => {
  const savedPlayerName = localStorage.getItem('playerName');
  const savedSessionId = localStorage.getItem('sessionId');
  
  if (savedPlayerName && savedSessionId && window.location.pathname === '/') {
    // Try to rejoin the session
    socket.emit('join-session', { 
      sessionId: savedSessionId, 
      playerName: savedPlayerName 
    });
  }
});

socket.on('game-state', (data) => {
  // If we successfully joined/rejoined, go to game page
  const currentPlayer = data.players.find(p => p.id === socket.id);
  if (currentPlayer) {
    localStorage.setItem('playerName', currentPlayer.name);
  }
  localStorage.setItem('sessionId', data.sessionId);
  if (window.location.pathname !== '/game.html') {
    window.location.href = 'game.html';
  }
});
