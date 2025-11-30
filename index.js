require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(`${process.env.STRIPE_SECRET_KEY}`);
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
    origin: [process.env.CLIENT_DOMAIN_URL],
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
    const ordersCollection = db.collection("orders");

    //? post api for posting plants in the db
    app.post("/plants", async (req, res) => {
      try {
        const newPlants = req.body;
        //? validate newPlants if not found
        if (!newPlants || Object.keys(newPlants).length === 0) {
          return res.status(400).json({
            status: false,
            message: "Plants data required!!!",
          });
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
          error: error.message,
        });
      }
    });

    //? get all the plants from db by calling its api
    app.get("/plants", async (req, res) => {
      try {
        const result = await plantsCollection.find().toArray();
        res.status(200).json({
          status: true,
          message: "Get plants data from db successful",
          result: result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get plants data",
          error: error.message,
        });
      }
    });

    //? get single plant data by calling api with id
    app.get("/plants/:id", async (req, res) => {
      try {
        const plantId = req.params.id;

        //? checking valid Object id or not
        if (!ObjectId.isValid(plantId)) {
          return res.status(400).json({
            status: false,
            message: "Invalid Plant id",
          });
        }

        const query = { _id: new ObjectId(plantId) };
        const result = await plantsCollection.findOne(query);

        //? checking result is available or not
        if (!result) {
          return res.status(404).json({
            status: false,
            message: "plant not found",
          });
        }

        res.status(200).json({
          status: true,
          message: "Get single plant data from db successful",
          result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get single plant data from db",
          error: error.message,
        });
      }
    });

    //? Stripe Payment endpoint api setup
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const paymentInfo = req.body;
        // console.log(paymentInfo);

        //? convert this value in Number()
        const price = Number(paymentInfo?.price);
        //? validate price with isNaN
        if (isNaN(price) || price <= 0) {
          return res.status(400).json({
            status: false,
            message: "Invalid number",
          });
        }
        //? convert this last value to us cents-->
        const unitFinalPrice = Math.round(price * 100);
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: paymentInfo?.name,
                  description: paymentInfo?.description,
                  images: paymentInfo?.image ? [paymentInfo?.image] : undefined,
                },
                unit_amount: unitFinalPrice,
              },
              quantity: 1,
            },
          ],
          customer_email: paymentInfo?.customer?.email || undefined,
          mode: "payment",
          metadata: {
            plantId: paymentInfo?.plantId || "",
            customer_name: paymentInfo?.customer?.name || undefined,
            customer_email: paymentInfo?.customer?.email || undefined,
          },
          success_url: `${process.env.CLIENT_DOMAIN_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.CLIENT_DOMAIN_URL}/plant/${paymentInfo?.plantId}`,
        });
        // console.log(session)
        // console.log(session.id)
        // console.log(session.payment_status)
        res.status(201).json({
          status: true,
          message: "Stripe payment session created successful",
          url: session.url,
          id: session.id,
        });
      } catch (error) {
        console.log(error.message);
        res.status(500).json({
          status: false,
          message: "Stripe Payment creation failed",
          error: error.message,
        });
      }
    });

    //? Session id api create endpoint
    app.post("/payment-success", async (req, res) => {
      try {
        const sessionId = req.body.sessionId;
        // console.log(sessionId);

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        console.log("session retrieve-->", session);
        //? getting single plant data from db
        const plant = await plantsCollection.findOne({
          _id: new ObjectId(session?.metadata?.plantId),
        });

        //? validate plant data from db
        if (!plant) {
          return res.status(404).json({
            status: false,
            message: "Plant not found",
          });
        }

        const order = await ordersCollection.findOne({
          transactionId: session?.payment_intent,
        });

        if (!order) {
          if (session?.payment_status !== "paid") {
            return res.status(400).json({
              status: false,
              message: "Payment Not Complete",
            });
          } else {
            const orderInfo = {
              plantId: session?.metadata?.plantId,
              transactionId: session?.payment_intent,
              customer_email: session?.customer_email,
              status: "pending",
              seller: plant?.seller,
              name: plant?.name,
              category: plant?.category,
              quantity: 1,
              price: session?.amount_total / 100,
            };
            console.log(orderInfo);
            const result = await ordersCollection.insertOne(orderInfo);

            //? update plant quantity
            await plantsCollection.updateOne(
              {
                _id: new ObjectId(session?.metadata?.plantId),
              },
              { $inc: { quantity: -1 } }
            );

            res.status(201).json({
              status: true,
              message: "Order created Successfully",
              result,
              plant,
            });
          }
        } else {
          return res.status(409).json({
            status: false,
            message: "Order already exists",
          });
        }
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to create payment success api data",
          error: error.message,
        });
      }
    });

    //? get all the orders for a customer by email query
    app.get("/my-orders", async (req, res) => {
      try {
        const email = req.query.email;
        const query = {};
        if (email) {
          query.customer_email = email;
        }
        const result = await ordersCollection.find(query).toArray();
        res.status(200).json({
          status: true,
          message: "Get all the customer order by email query successful",
          result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get all the customer orders by email",
          error: error.message,
        });
      }
    });

    //? get all the product added by seller by seller email
    app.get("/seller-product-orders", async (req, res) => {
      try {
        const email = req.query.email;
        const query = {};
        if (email) {
          query["seller.email"] = email;
        }
        const result = await ordersCollection.find(query).toArray();
        res.status(200).json({
          status: true,
          message: "Get all the seller product orders by email query successful",
          result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get all the seller product orders by email",
          error: error.message,
        })
      }
    });

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
