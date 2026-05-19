import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("MONGODB_URI is missing in server/.env");
}

const petsPath = path.join(__dirname, "pets.json");
const pets = JSON.parse(fs.readFileSync(petsPath, "utf-8"));

async function seedPets() {
  const client = new MongoClient(uri);

  try {
    await client.connect();

    const db = client.db("pawnest");
    const petsCollection = db.collection("pets");

    await petsCollection.deleteMany({});
    await petsCollection.insertMany(
      pets.map((pet: any) => ({
        ...pet,
        createdAt: new Date(),
      }))
    );

    console.log(`Seeded ${pets.length} pets into MongoDB`);
  } catch (error) {
    console.error("Seed error:", error);
  } finally {
    await client.close();
  }
}

seedPets();