import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import cors from "cors";
import { MongoClient, ObjectId, Db, Collection } from "mongodb";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || "default_pet_adoption_secret";
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is missing in environment configurations");
}

const app = express();

// Configure CORS using dynamic production/development origins
const allowedOrigins = [
  "http://localhost:5173", 
  "http://localhost:3000",
  process.env.CLIENT_URL
].filter(Boolean) as string[];

app.use(
  cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// Serverless-safe Database Connection Strategy
let mongoClient: MongoClient | null = null;
let cachedDb: Db | null = null;

async function getCollections(): Promise<{ petsCollection: Collection; requestsCollection: Collection }> {
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGODB_URI!);
    await mongoClient.connect();
  }
  if (!cachedDb) {
    cachedDb = mongoClient.db("pawnest");
  }
  
  return {
    petsCollection: cachedDb.collection("pets"),
    requestsCollection: cachedDb.collection("requests")
  };
}

// System Health Route
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", environment: process.env.NODE_ENV || "development" });
});

// Auth routes
app.post("/api/auth/login", (req, res) => {
  const { user } = req.body;
  if (!user) return res.status(400).json({ error: "User info required" });

  const token = jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });

  res.cookie("token", token, {
    httpOnly: true,
    secure: true, 
    sameSite: "none", 
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({ message: "Logged in successfully", user });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", { httpOnly: true, secure: true, sameSite: "none" });
  res.json({ message: "Logged out successfully" });
});

app.get("/api/auth/user", (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: "Not authenticated" });

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
    const { petsCollection } = await getCollections();
    const { search, species, sort, sortBy, sortOrder, limit, ownerEmail } = req.query;
    const query: any = {};

    if (ownerEmail) query.ownerEmail = String(ownerEmail);
    if (search) query.name = { $regex: String(search), $options: "i" };
    if (species && species !== "All") query.species = { $in: String(species).split(",") };

    let cursor = petsCollection.find(query);

    if (sort === "fee-asc") cursor = cursor.sort({ adoptionFee: 1 });
    if (sort === "fee-desc") cursor = cursor.sort({ adoptionFee: -1 });
    if (sort === "newest") cursor = cursor.sort({ createdAt: -1 });

    if (sortBy === "name") cursor = cursor.sort({ name: sortOrder === "asc" ? 1 : -1 });
    if (sortBy === "adoptionFee") cursor = cursor.sort({ adoptionFee: sortOrder === "asc" ? 1 : -1 });
    if (sortBy === "age") cursor = cursor.sort({ age: sortOrder === "asc" ? 1 : -1 });
    if (sortBy === "createdAt") cursor = cursor.sort({ createdAt: sortOrder === "asc" ? 1 : -1 });

    if (limit) cursor = cursor.limit(Number(limit));

    const pets = await cursor.toArray();
    res.json(pets);
  } catch (error) {
    console.error("Error fetching pets database entry layout:", error);
    res.status(500).json({ error: "Failed to load pets from server" });
  }
});

app.get("/api/pets/:id", async (req, res) => {
  try {
    const { petsCollection } = await getCollections();
    const pet = await petsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!pet) return res.status(404).json({ error: "Pet not found" });
    res.json(pet);
  } catch {
    res.status(400).json({ error: "Invalid pet id" });
  }
});

app.post("/api/pets", async (req, res) => {
  try {
    const { petsCollection } = await getCollections();
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
    const { petsCollection } = await getCollections();
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
    const { petsCollection } = await getCollections();
    const result = await petsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to delete pet" });
  }
});

// Requests routes
app.get("/api/requests", async (req, res) => {
  try {
    const { requestsCollection } = await getCollections();
    const { email, ownerEmail, petId } = req.query;
    const query: any = {};

    if (email) query.userEmail = email;
    if (ownerEmail) query.ownerEmail = ownerEmail;
    if (petId) query.petId = petId;

    const requests = await requestsCollection.find(query).sort({ requestDate: -1 }).toArray();
    res.json(requests);
  } catch (error) {
    console.error("Requests extraction endpoint layout failure:", error);
    res.status(500).json({ error: "Failed to load requests from system engine" });
  }
});

app.post("/api/requests", async (req, res) => {
  try {
    const { petsCollection, requestsCollection } = await getCollections();
    const { petId, userEmail, ownerEmail } = req.body;
    if (userEmail === ownerEmail) {
      return res.status(403).json({ error: "Pet owners cannot adopt their own pets" });
    }

    const pet = await petsCollection.findOne({ _id: new ObjectId(petId) });
    if (!pet) return res.status(404).json({ error: "Pet not found" });
    if (pet.status === "adopted") return res.status(400).json({ error: "This pet is already adopted" });

    const existing = await requestsCollection.findOne({ petId, userEmail });
    if (existing) return res.status(400).json({ error: "You already requested this pet" });

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
    const { petsCollection, requestsCollection } = await getCollections();
    const { status, petId } = req.body;

    if (status === "approved") {
      await requestsCollection.updateMany({ petId }, { $set: { status: "rejected" } });
      await petsCollection.updateOne({ _id: new ObjectId(petId) }, { $set: { status: "adopted" } });
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
    const { requestsCollection } = await getCollections();
    const result = await requestsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to cancel request" });
  }
});

// CRITICAL EXPORT FOR VERCEL SERVERLESS ENGINE
export default app;

if (process.env.NODE_ENV !== "production") {
  const LOCAL_PORT = process.env.PORT || 3001;
  app.listen(LOCAL_PORT, () => {
    console.log(`[Local Dev] Server is running on http://localhost:${LOCAL_PORT}`);
  });
}