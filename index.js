const PORT = process.env.PORT || 5000;
const IO = require("socket.io")(PORT, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

console.log("🚀 Signalling server running on port", PORT);

// auth middleware
IO.use((socket, next) => {
  const callerId = socket.handshake.query.callerId;
  if (!callerId) {
    return next(new Error("callerId is required"));
  }
  socket.user = callerId;
  next();
});

IO.on("connection", (socket) => {
  console.log(`✅ User connected: ${socket.user}`);
  socket.join(socket.user);

  socket.on("makeCall", ({ calleeId, sdpOffer }) => {
    console.log(`📞 ${socket.user} is calling ${calleeId}`);
    socket.to(calleeId).emit("newCall", {
      callerId: socket.user,
      sdpOffer,
    });
  });

  socket.on("answerCall", ({ callerId, sdpAnswer }) => {
    console.log(`📲 ${socket.user} answered call from ${callerId}`);
    socket.to(callerId).emit("callAnswered", {
      callee: socket.user,
      sdpAnswer,
    });
  });

  socket.on("IceCandidate", ({ calleeId, iceCandidate }) => {
    console.log(`❄ ICE from ${socket.user} → ${calleeId}`);
    socket.to(calleeId).emit("IceCandidate", {
      sender: socket.user,
      iceCandidate,
    });
  });

  socket.on("disconnect", () => {
    console.log(`❌ User disconnected: ${socket.user}`);
  });
});
