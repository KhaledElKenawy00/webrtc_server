const PORT = process.env.PORT || 5000;
const IO = require("socket.io")(PORT, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

console.log("🚀 Group Calling server running on port", PORT);

// تخزين الـ rooms والمستخدمين
const rooms = new Map();
const users = new Map();

IO.use((socket, next) => {
  const userId = socket.handshake.query.userId;
  const username = socket.handshake.query.username || `User-${Math.random().toString(36).substr(2, 5)}`;
  
  if (!userId) {
    return next(new Error("userId is required"));
  }
  
  socket.user = {
    id: userId,
    username: username,
    socketId: socket.id
  };
  
  users.set(socket.id, socket.user);
  next();
});

IO.on("connection", (socket) => {
  console.log(`\n✅ User connected: ${socket.user.username} (${socket.user.id}) [${socket.id}]`);
  
  socket.on("joinRoom", ({ roomId }) => {
    console.log(`\n🚪 ${socket.user.username} trying to join room: ${roomId}`);
    
    // ترك أي room سابق
    socket.rooms.forEach(room => {
      if (room !== socket.id) {
        console.log(`   Leaving previous room: ${room}`);
        socket.leave(room);
      }
    });
    
    // تنظيم الـ room إذا لم يكن موجود
    if (!rooms.has(roomId)) {
      console.log(`   Creating NEW room: ${roomId}`);
      rooms.set(roomId, new Set());
    } else {
      console.log(`   Joining EXISTING room: ${roomId}`);
    }
    
    const room = rooms.get(roomId);
    
    // التحقق من أن المستخدم ليس بالفعل في الغرفة
    if (room.has(socket.id)) {
      console.log(`   ❌ User already in room ${roomId}`);
      return;
    }
    
    // إضافة المستخدم إلى الـ room
    room.add(socket.id);
    
    // انضمام المستخدم إلى الـ room
    socket.join(roomId);
    socket.currentRoom = roomId;
    
    // الحصول على جميع المستخدمين في الـ room
    const usersInRoom = Array.from(room)
      .filter(socketId => socketId !== socket.id)
      .map(socketId => {
        const user = users.get(socketId);
        return {
          id: user.id,
          username: user.username,
          socketId: socketId
        };
      });
    
    console.log(`   Room ${roomId} now has ${room.size} users`);
    
    if (usersInRoom.length > 0) {
      console.log(`   Other users in room:`);
      usersInRoom.forEach(user => {
        console.log(`     - ${user.username} (${user.socketId})`);
      });
    } else {
      console.log(`   No other users in room (first user)`);
    }
    
    // إرسال قائمة المستخدمين الحاليين للمستخدم الجديد
    socket.emit("roomJoined", {
      roomId,
      users: usersInRoom
    });
    
    // إشعار المستخدمين الآخرين بالمستخدم الجديد
    if (usersInRoom.length > 0) {
      console.log(`   Notifying other users about new user...`);
      socket.to(roomId).emit("userJoined", {
        user: {
          id: socket.user.id,
          username: socket.user.username,
          socketId: socket.id
        }
      });
    }
    
    console.log(`✅ ${socket.user.username} successfully joined room ${roomId}\n`);
  });
  
  socket.on("offer", ({ targetSocketId, sdpOffer }) => {
    const targetSocket = IO.sockets.sockets.get(targetSocketId);
    if (!targetSocket) {
      console.log(`❌ Target socket not found: ${targetSocketId}`);
      return;
    }
    
    console.log(`📡 ${socket.user.username} → ${targetSocket.user.username}: sending offer`);
    
    // إرسال العرض إلى المستخدم الهدف
    targetSocket.emit("offer", {
      fromSocketId: socket.id,
      fromUserId: socket.user.id,
      fromUsername: socket.user.username,
      sdpOffer
    });
  });
  
  socket.on("answer", ({ targetSocketId, sdpAnswer }) => {
    const targetSocket = IO.sockets.sockets.get(targetSocketId);
    if (!targetSocket) {
      console.log(`❌ Target socket not found: ${targetSocketId}`);
      return;
    }
    
    console.log(`📡 ${socket.user.username} → ${targetSocket.user.username}: sending answer`);
    
    targetSocket.emit("answer", {
      fromSocketId: socket.id,
      fromUserId: socket.user.id,
      sdpAnswer
    });
  });
  
  socket.on("iceCandidate", ({ targetSocketId, iceCandidate }) => {
    const targetSocket = IO.sockets.sockets.get(targetSocketId);
    if (!targetSocket) {
      console.log(`❌ Target socket not found: ${targetSocketId}`);
      return;
    }
    
    console.log(`❄ ${socket.user.username} → ${targetSocket.user.username}: sending ICE candidate`);
    
    targetSocket.emit("iceCandidate", {
      fromSocketId: socket.id,
      fromUserId: socket.user.id,
      iceCandidate
    });
  });
  
  socket.on("leaveRoom", ({ roomId }) => {
    console.log(`\n🚪 ${socket.user.username} leaving room: ${roomId}`);
    
    const room = rooms.get(roomId);
    if (room) {
      room.delete(socket.id);
      
      // إشعار المستخدمين الآخرين بالمغادرة
      socket.to(roomId).emit("userLeft", {
        userId: socket.user.id,
        socketId: socket.id
      });
      
      // إذا كانت الـ room فارغة، احذفها
      if (room.size === 0) {
        rooms.delete(roomId);
        console.log(`🗑️ Room ${roomId} deleted (empty)`);
      } else {
        console.log(`   Room ${roomId} now has ${room.size} users remaining`);
      }
    }
    
    socket.leave(roomId);
    delete socket.currentRoom;
    
    console.log(`✅ ${socket.user.username} left room ${roomId}\n`);
  });
  
  socket.on("disconnect", () => {
    console.log(`\n❌ User disconnected: ${socket.user.username} (${socket.user.id})`);
    
    // إزالة المستخدم من التخزين
    users.delete(socket.id);
    
    // إزالة المستخدم من جميع الـ rooms
    rooms.forEach((room, roomId) => {
      if (room.has(socket.id)) {
        room.delete(socket.id);
        
        // إشعار المستخدمين الآخرين بالمغادرة
        socket.to(roomId).emit("userLeft", {
          userId: socket.user.id,
          socketId: socket.id
        });
        
        if (room.size === 0) {
          rooms.delete(roomId);
          console.log(`🗑️ Room ${roomId} deleted (empty)`);
        } else {
          console.log(`   Room ${roomId} still has ${room.size} users`);
        }
      }
    });
    
    console.log(`✅ Cleaned up after ${socket.user.username}\n`);
  });
});