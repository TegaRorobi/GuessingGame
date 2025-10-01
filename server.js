const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static('public'));

// Game sessions storage
const gameSessions = new Map();

// Helper functions
function generateSessionId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getNextGameMaster(players) {
  const playerIds = Array.from(players.keys());
  if (playerIds.length === 0) return null;
  
  // Find current game master
  let currentMasterIndex = -1;
  for (let i = 0; i < playerIds.length; i++) {
    if (players.get(playerIds[i]).isGameMaster) {
      currentMasterIndex = i;
      break;
    }
  }
  
  // Get next player in rotation
  const nextIndex = (currentMasterIndex + 1) % playerIds.length;
  return playerIds[nextIndex];
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Create game session
  socket.on('create-session', (playerName) => {
    if (!playerName || playerName.trim() === '') {
      socket.emit('error', 'Player name is required');
      return;
    }

    const sessionId = generateSessionId();
    const gameSession = {
      id: sessionId,
      players: new Map(),
      gameState: 'waiting', // waiting, active, ended
      currentQuestion: null,
      currentAnswer: null,
      timer: null,
      gameStartTime: null
    };

    // Add player as game master
    gameSession.players.set(socket.id, {
      id: socket.id,
      name: playerName.trim(),
      score: 0,
      isGameMaster: true,
      attempts: 0
    });

    gameSessions.set(sessionId, gameSession);
    socket.join(sessionId);
    socket.sessionId = sessionId;

    socket.emit('session-created', { sessionId, playerName });
    
    // Send game state immediately after session creation
    socket.emit('game-state', {
      sessionId,
      players: Array.from(gameSession.players.values()),
      gameState: gameSession.gameState
    });
  });

  // Join game session
  socket.on('join-session', ({ sessionId, playerName }) => {
    if (!playerName || playerName.trim() === '' || !sessionId) {
      socket.emit('error', 'Player name and session ID are required');
      return;
    }

    const gameSession = gameSessions.get(sessionId);
    if (!gameSession) {
      socket.emit('error', 'Session not found');
      return;
    }

    if (gameSession.gameState === 'active') {
      socket.emit('error', 'Cannot join game in progress');
      return;
    }

    // Check if player is already in the session (reconnecting)
    const existingPlayer = Array.from(gameSession.players.values()).find(p => p.name === playerName.trim());
    if (existingPlayer) {
      // Update the socket ID for reconnecting player
      gameSession.players.delete(existingPlayer.id);
      existingPlayer.id = socket.id;
      gameSession.players.set(socket.id, existingPlayer);
      socket.join(sessionId);
      socket.sessionId = sessionId;
      
      socket.emit('game-state', {
        sessionId,
        players: Array.from(gameSession.players.values()),
        gameState: gameSession.gameState
      });
      
      io.to(sessionId).emit('game-state', {
        sessionId,
        players: Array.from(gameSession.players.values()),
        gameState: gameSession.gameState
      });
      return;
    }
    
    // Add player
    gameSession.players.set(socket.id, {
      id: socket.id,
      name: playerName.trim(),
      score: 0,
      isGameMaster: false,
      attempts: 0
    });

    socket.join(sessionId);
    socket.sessionId = sessionId;

    // Notify all players
    io.to(sessionId).emit('player-joined', {
      playerName: playerName.trim(),
      playerCount: gameSession.players.size
    });

    io.to(sessionId).emit('game-state', {
      sessionId,
      players: Array.from(gameSession.players.values()),
      gameState: gameSession.gameState
    });
  });

  // Start game (only game master)
  socket.on('start-game', ({ question, answer }) => {
    const sessionId = socket.sessionId;
    const gameSession = gameSessions.get(sessionId);

    if (!gameSession) {
      socket.emit('error', 'Session not found');
      return;
    }

    const player = gameSession.players.get(socket.id);
    if (!player || !player.isGameMaster) {
      socket.emit('error', 'Only game master can start the game');
      return;
    }

    if (gameSession.players.size < 3) {
      socket.emit('error', 'Need at least 2 other players (3 total) to start the game');
      return;
    }

    if (!question || !answer || question.trim() === '' || answer.trim() === '') {
      socket.emit('error', 'Question and answer are required');
      return;
    }

    // Reset all players' attempts
    gameSession.players.forEach(player => {
      player.attempts = 0;
    });

    gameSession.gameState = 'active';
    gameSession.currentQuestion = question.trim();
    gameSession.currentAnswer = answer.trim().toLowerCase();
    gameSession.gameStartTime = Date.now();

    // Start 60-second timer
    gameSession.timer = setTimeout(() => {
      endGame(sessionId, null, 'timeout');
    }, 60000);

    io.to(sessionId).emit('game-started', {
      question: gameSession.currentQuestion,
      players: Array.from(gameSession.players.values()),
      timeLimit: 60
    });

    io.to(sessionId).emit('system-message', {
      message: `Game started! Question: "${gameSession.currentQuestion}"`,
      type: 'system'
    });
  });

  // Submit guess
  socket.on('submit-guess', (guess) => {
    const sessionId = socket.sessionId;
    const gameSession = gameSessions.get(sessionId);

    if (!gameSession) {
      socket.emit('error', 'Session not found');
      return;
    }

    if (gameSession.gameState !== 'active') {
      socket.emit('error', 'Game is not active');
      return;
    }

    const player = gameSession.players.get(socket.id);
    if (!player) {
      socket.emit('error', 'Player not found');
      return;
    }

    if (player.isGameMaster) {
      socket.emit('error', 'Game master cannot submit guesses');
      return;
    }

    if (player.attempts >= 3) {
      socket.emit('error', 'You have used all your attempts');
      return;
    }

    if (!guess || guess.trim() === '') {
      socket.emit('error', 'Guess cannot be empty');
      return;
    }

    player.attempts++;
    const guessLower = guess.trim().toLowerCase();
    const isCorrect = guessLower === gameSession.currentAnswer;

    // Broadcast the guess
    io.to(sessionId).emit('player-message', {
      playerName: player.name,
      message: guess.trim(),
      attempts: player.attempts,
      type: 'guess'
    });

    if (isCorrect) {
      endGame(sessionId, socket.id, 'correct');
    } else {
      socket.emit('guess-result', {
        correct: false,
        attemptsLeft: 3 - player.attempts
      });

      if (player.attempts >= 3) {
        socket.emit('system-message', {
          message: 'You have used all your attempts!',
          type: 'error'
        });
      }
    }
  });

  // Send chat message
  socket.on('chat-message', (message) => {
    const sessionId = socket.sessionId;
    const gameSession = gameSessions.get(sessionId);

    if (!gameSession) return;

    const player = gameSession.players.get(socket.id);
    if (!player) return;

    if (!message || message.trim() === '') return;

    io.to(sessionId).emit('player-message', {
      playerName: player.name,
      message: message.trim(),
      type: 'chat'
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    console.log('gameSessions before cleanup:', gameSessions.size);
    
    const sessionId = socket.sessionId;
    if (sessionId) {
      const gameSession = gameSessions.get(sessionId);
      if (gameSession) {
        const player = gameSession.players.get(socket.id);
        
        // Don't immediately delete player - they might be reconnecting
        // Only clean up after a delay to allow for reconnections
        setTimeout(() => {
          const currentSession = gameSessions.get(sessionId);
          if (currentSession && currentSession.players.has(socket.id)) {
            currentSession.players.delete(socket.id);
            
            if (currentSession.players.size === 0) {
              // Delete session if no players left after delay
              if (currentSession.timer) {
                clearTimeout(currentSession.timer);
              }
              gameSessions.delete(sessionId);
              console.log('Session deleted due to no players after delay:', sessionId);
            } else {
              // Notify remaining players
              if (player) {
                io.to(sessionId).emit('player-left', {
                  playerName: player.name,
                  playerCount: currentSession.players.size
                });
              }

              // If game master left, assign new game master
              if (player && player.isGameMaster) {
                const nextMasterId = Array.from(currentSession.players.keys())[0];
                if (nextMasterId) {
                  currentSession.players.get(nextMasterId).isGameMaster = true;
                  io.to(sessionId).emit('new-game-master', {
                    newMasterName: currentSession.players.get(nextMasterId).name
                  });
                }
              }

              io.to(sessionId).emit('game-state', {
                sessionId,
                players: Array.from(currentSession.players.values()),
                gameState: currentSession.gameState
              });
            }
          }
        }, 5000); // 5 second delay to allow reconnection
        
        if (gameSession.players.size > 0) {
          // Notify remaining players
          if (player) {
            io.to(sessionId).emit('player-left', {
              playerName: player.name,
              playerCount: gameSession.players.size
            });
          }

          // If game master left, assign new game master
          if (player && player.isGameMaster) {
            const nextMasterId = Array.from(gameSession.players.keys())[0];
            if (nextMasterId) {
              gameSession.players.get(nextMasterId).isGameMaster = true;
              io.to(sessionId).emit('new-game-master', {
                newMasterName: gameSession.players.get(nextMasterId).name
              });
            }
          }

          io.to(sessionId).emit('game-state', {
            sessionId,
            players: Array.from(gameSession.players.values()),
            gameState: gameSession.gameState
          });
        }
      }
    }
  });

  function endGame(sessionId, winnerId, reason) {
    const gameSession = gameSessions.get(sessionId);
    if (!gameSession) return;

    gameSession.gameState = 'ended';
    
    if (gameSession.timer) {
      clearTimeout(gameSession.timer);
      gameSession.timer = null;
    }

    let winnerData = null;
    if (winnerId && reason === 'correct') {
      const winner = gameSession.players.get(winnerId);
      if (winner) {
        winner.score += 10;
        winnerData = {
          id: winnerId,
          name: winner.name,
          score: winner.score
        };
      }
    }

    io.to(sessionId).emit('game-ended', {
      reason,
      winner: winnerData,
      correctAnswer: gameSession.currentAnswer,
      players: Array.from(gameSession.players.values())
    });

    // Rotate game master
    let currentMasterIndex = -1;
    const playerIds = Array.from(gameSession.players.keys());
    
    for (let i = 0; i < playerIds.length; i++) {
      if (gameSession.players.get(playerIds[i]).isGameMaster) {
        currentMasterIndex = i;
        gameSession.players.get(playerIds[i]).isGameMaster = false;
        break;
      }
    }
    
    // Set next player as game master
    if (playerIds.length > 0) {
      const nextIndex = (currentMasterIndex + 1) % playerIds.length;
      const nextMasterId = playerIds[nextIndex];
      gameSession.players.get(nextMasterId).isGameMaster = true;
      
      io.to(sessionId).emit('new-game-master', {
        newMasterName: gameSession.players.get(nextMasterId).name
      });
    }

    // Reset game state
    setTimeout(() => {
      if (gameSessions.has(sessionId)) {
        gameSession.gameState = 'waiting';
        gameSession.currentQuestion = null;
        gameSession.currentAnswer = null;
        
        io.to(sessionId).emit('game-state', {
          sessionId,
          players: Array.from(gameSession.players.values()),
          gameState: gameSession.gameState
        });
      }
    }, 3000);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
