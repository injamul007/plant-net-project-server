require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://b12-m11-session.web.app",
    ],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    await client.connect();

    //? Database and collection setup
    const db = client.db("plantnetDB");
    const plantsCollection = db.collection("plants");

    //? post api for posting plants in the db
    app.post("/plants", async (req, res) => {
      try {
        const newPlants = req.body;
        //? validate newPlants if not found
        if(!newPlants || Object.keys(newPlants).length === 0) {
          return res.status(400).json({
            status: false,
            message: "Plants data required!!!"
          })
        }
        const result = await plantsCollection.insertOne(newPlants);
        res.status(201).json({
          status: true,
          message: "creating plants data successful",
          result: result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to post plants data",
          error: error.message
        })
      }
    });

    //? get all the plants from db by calling its api
    app.get("/plants", async(req,res) => {
      try {
        const result = await plantsCollection.find().toArray();
        res.status(200).json({
          status: true,
          message: "Get plants data from db successful",
          result: result
        })
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get plants data",
          error: error.message
        })
      }
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Server..");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
