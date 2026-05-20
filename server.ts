import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import { createServer as createViteServer } from "vite";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || "default_pet_adoption_secret";
const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is missing in server/.env");
}

async function startServer() {
  const app = express();

  app.use(
    cors({
      origin: ["http://localhost:5173", "http://localhost:3000"],
      credentials: true,
    })
  );

  app.use(express.json());
  app.use(cookieParser());

  const mongoClient = new MongoClient(MONGODB_URI);
  await mongoClient.connect();

  const db = mongoClient.db("pawnest");
  const petsCollection = db.collection("pets");
  const requestsCollection = db.collection("requests");

  console.log("MongoDB connected successfully");

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Auth routes
  app.post("/api/auth/login", (req, res) => {
    const { user } = req.body;

    if (!user) {
      return res.status(400).json({ error: "User info required" });
    }

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ message: "Logged in successfully", user });
  });

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ message: "Logged out successfully" });
  });

  app.get("/api/auth/user", (req, res) => {
    const token = req.cookies?.token;

    if (!token) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      res.json({ user: decoded });
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  // Pets routes
  app.get("/api/pets", async (req, res) => {
  try {
    const { search, species, sort, sortBy, sortOrder, limit, ownerEmail } =
      req.query;

    const query: any = {};

    if (ownerEmail) {
      query.ownerEmail = String(ownerEmail);
    }

    if (search) {
      query.name = { $regex: String(search), $options: "i" };
    }

    if (species && species !== "All") {
      query.species = { $in: String(species).split(",") };
    }

    let cursor = petsCollection.find(query);

    if (sort === "fee-asc") cursor = cursor.sort({ adoptionFee: 1 });
    if (sort === "fee-desc") cursor = cursor.sort({ adoptionFee: -1 });
    if (sort === "newest") cursor = cursor.sort({ createdAt: -1 });

    if (sortBy === "name") {
      cursor = cursor.sort({ name: sortOrder === "asc" ? 1 : -1 });
    }

    if (sortBy === "adoptionFee") {
      cursor = cursor.sort({ adoptionFee: sortOrder === "asc" ? 1 : -1 });
    }

    if (sortBy === "age") {
      cursor = cursor.sort({ age: sortOrder === "asc" ? 1 : -1 });
    }

    if (sortBy === "createdAt") {
      cursor = cursor.sort({ createdAt: sortOrder === "asc" ? 1 : -1 });
    }

    if (limit) {
      cursor = cursor.limit(Number(limit));
    }

    const pets = await cursor.toArray();
    res.json(pets);
  } catch (error) {
    res.status(500).json({ error: "Failed to load pets" });
  }
});

  app.get("/api/pets/:id", async (req, res) => {
    try {
      const pet = await petsCollection.findOne({
        _id: new ObjectId(req.params.id),
      });

      if (!pet) {
        return res.status(404).json({ error: "Pet not found" });
      }

      res.json(pet);
    } catch {
      res.status(400).json({ error: "Invalid pet id" });
    }
  });

  app.post("/api/pets", async (req, res) => {
    try {
      const pet = {
        ...req.body,
        status: req.body.status || "available",
        createdAt: new Date(),
      };

      const result = await petsCollection.insertOne(pet);
      res.status(201).json({ insertedId: result.insertedId });
    } catch {
      res.status(500).json({ error: "Failed to add pet" });
    }
  });

  app.patch("/api/pets/:id", async (req, res) => {
    try {
      const result = await petsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body }
      );

      res.json(result);
    } catch {
      res.status(500).json({ error: "Failed to update pet" });
    }
  });

  app.delete("/api/pets/:id", async (req, res) => {
    try {
      const result = await petsCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });

      res.json(result);
    } catch {
      res.status(500).json({ error: "Failed to delete pet" });
    }
  });

  // Requests routes
  app.get("/api/requests", async (req, res) => {
    try {
      const { email, ownerEmail, petId } = req.query;

      const query: any = {};

      if (email) query.userEmail = email;
      if (ownerEmail) query.ownerEmail = ownerEmail;
      if (petId) query.petId = petId;

      const requests = await requestsCollection
        .find(query)
        .sort({ requestDate: -1 })
        .toArray();

      res.json(requests);
    } catch {
      res.status(500).json({ error: "Failed to load requests" });
    }
  });

  app.post("/api/requests", async (req, res) => {
    try {
      const { petId, userEmail, ownerEmail } = req.body;

      if (userEmail === ownerEmail) {
        return res.status(403).json({
          error: "Pet owners cannot adopt their own pets",
        });
      }

      const pet = await petsCollection.findOne({
        _id: new ObjectId(petId),
      });

      if (!pet) {
        return res.status(404).json({ error: "Pet not found" });
      }

      if (pet.status === "adopted") {
        return res.status(400).json({ error: "This pet is already adopted" });
      }

      const existing = await requestsCollection.findOne({
        petId,
        userEmail,
      });

      if (existing) {
        return res.status(400).json({
          error: "You already requested this pet",
        });
      }

      const request = {
        ...req.body,
        status: "pending",
        requestDate: new Date(),
      };

      const result = await requestsCollection.insertOne(request);
      res.status(201).json({ insertedId: result.insertedId });
    } catch {
      res.status(500).json({ error: "Failed to create request" });
    }
  });

  app.patch("/api/requests/:id", async (req, res) => {
    try {
      const { status, petId } = req.body;

      if (status === "approved") {
        await requestsCollection.updateMany(
          { petId },
          { $set: { status: "rejected" } }
        );

        await petsCollection.updateOne(
          { _id: new ObjectId(petId) },
          { $set: { status: "adopted" } }
        );
      }

      const result = await requestsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status } }
      );

      res.json(result);
    } catch {
      res.status(500).json({ error: "Failed to update request" });
    }
  });

  app.delete("/api/requests/:id", async (req, res) => {
    try {
      const result = await requestsCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });

      res.json(result);
    } catch {
      res.status(500).json({ error: "Failed to cancel request" });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      root: path.resolve(__dirname, "../client"),
      server: {
        middlewareMode: true,
      },
      appType: "spa",
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "../client/dist");

    app.use(express.static(distPath));

    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();