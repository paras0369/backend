const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const therapistRoutes = require("./routes/therapists");
const callRoutes = require("./routes/calls");
const socketHandler = require("./socket/socketHandler");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : ["http://localhost:*", "exp://*"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/therapist_call_app";

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", "ws:", "wss:"],
      },
    },
  })
);
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : ["http://localhost:*", "exp://*"],
    credentials: true,
  })
);
app.use(morgan("combined"));

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 login attempts per windowMs
  message: "Too many login attempts, please try again later.",
});

app.use(generalLimiter);
app.use("/api/auth", authLimiter);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/therapists", therapistRoutes);
app.use("/api/calls", callRoutes);

app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

socketHandler(io);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
