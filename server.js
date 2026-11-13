const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const SESSION_CODE = process.env.SESSION_CODE;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN;
const CONTROLLER_TOKEN = process.env.CONTROLLER_TOKEN;

const missingVariables = [
  ['SESSION_CODE', SESSION_CODE],
  ['DEVICE_TOKEN', DEVICE_TOKEN],
  ['CONTROLLER_TOKEN', CONTROLLER_TOKEN],
].filter(([, value]) => !value)
  .map(([name]) => name);

if (missingVariables.length > 0) {
  console.error(`Missing required environment variable(s): ${missingVariables.join(', ')}`);
  process.exitCode = 1;
} else {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://localhost');

    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' });
      response.end('Method Not Allowed');
      return;
    }

    if (requestUrl.pathname !== '/') {
      response.writeHead(404);
      response.end('Not Found');
      return;
    }

    fs.readFile(path.join(__dirname, 'index.html'), (error, content) => {
      if (error) {
        console.error('Unable to read index.html:', error);
        response.writeHead(500);
        response.end('Unable to load page');
        return;
      }

      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(content);
    });
  });

  const io = new Server(server);

  io.on('connection', (socket) => {
    let joinedRoom = null;
    let joinedRole = null;

    socket.on('join', ({ room, role, token } = {}) => {
      if (joinedRoom) {
        socket.emit('join:error', 'This connection has already joined a room.');
        return;
      }

      const expectedToken = role === 'device'
        ? DEVICE_TOKEN
        : role === 'controller'
          ? CONTROLLER_TOKEN
          : null;

      if (room !== SESSION_CODE || !expectedToken || token !== expectedToken) {
        socket.emit('join:error', 'Invalid room, role, or token.');
        return;
      }

      const roomSockets = io.sockets.adapter.rooms.get(room);
      if (roomSockets && [...roomSockets].some((id) => {
        const peer = io.sockets.sockets.get(id);
        return peer && peer.data.role === role;
      })) {
        socket.emit('join:error', `A ${role} is already connected.`);
        return;
      }

      const peerPresent = roomSockets && [...roomSockets].some((id) => {
        const peer = io.sockets.sockets.get(id);
        return peer && peer.data.role !== role;
      });
      joinedRoom = room;
      joinedRole = role;
      socket.data.role = role;
      socket.join(room);
      socket.emit('join:accepted', { peerPresent: Boolean(peerPresent) });
      socket.to(room).emit('peer:joined', { role });
    });

    socket.on('signal', (message) => {
      if (!joinedRoom || !['device', 'controller'].includes(joinedRole)) return;
      if (!message || !['offer', 'answer', 'ice'].includes(message.type)) return;
      socket.to(joinedRoom).emit('signal', message);
    });

    socket.on('disconnect', () => {
      if (joinedRoom && joinedRole) {
        socket.to(joinedRoom).emit('peer:left', { role: joinedRole });
      }
    });
  });

  server.listen(process.env.PORT || 3000, () => {
    console.log(`AmeriKIDS remote control server listening on port ${server.address().port}`);
  });
}
