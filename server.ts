import express from "express";
import { fileURLToPath } from "url";
import path from "path";
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



  app.use(express.json());

  console.log("MongoDB connected successfully");


  // Auth routes
 

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ message: "Logged out successfully" });
  });

    // Pets routes
  app.get("/api/pets", async (req, res) => {
    try {
      const { search, species, sort, limit } = req.query;

      const query: any = {};

      if (search) {
        query.name = { $regex: String(search), $options: "i" };
      }

      if (species && species !== "All") {
        query.species = { $in: String(species).split(",") };
      }

      let cursor = petsCollection.find(query);

      if (sort === "fee-asc") {
        cursor = cursor.sort({ adoptionFee: 1 });
      }

      if (sort === "fee-desc") {
        cursor = cursor.sort({ adoptionFee: -1 });
      }

      if (sort === "newest") {
        cursor = cursor.sort({ createdAt: -1 });
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




  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();