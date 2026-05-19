import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



const petsPath = path.join(__dirname, "pets.json");
const pets = JSON.parse(fs.readFileSync(petsPath, "utf-8"));

async function seedPets() {

    const petsCollection = db.collection("pets");

    await petsCollection.insertMany(
      pets.map((pet: any) => ({
        ...pet,
        createdAt: new Date(),
      }))
    );
  }
  


seedPets();