const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.3m2j3.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send("unauthorized access");
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
}

async function run() {
  try {
    const userCollection = client.db("MoblieMarket").collection("Users");
    const categoryCollection = client
      .db("MoblieMarket")
      .collection("Categories");
    const bookingCollection = client.db("MoblieMarket").collection("Bookings");
    const productCollection = client.db("MoblieMarket").collection("Products");
    const paymentCollection = client.db("MoblieMarket").collection("Payments");

    //using verification after jwt verify
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await userCollection.findOne(query);

      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    const verifySeller = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await userCollection.findOne(query);

      if (user?.role !== "seller") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //get api
    //get categories api
    app.get("/categories", async (req, res) => {
      const query = {};
      const categories = await categoryCollection.find(query).toArray();
      res.send(categories);
    });
    // get showCategoryProducts api
    app.get("/products/:id", async (req, res) => {
      const id = req.params.id;
      const query = {
        categoryId: id,
      };
      const products = await productCollection.find(query).toArray();
      res.send(products);
    });
    //get myproducts-seller api
    app.get("/myproducts", async (req, res) => {
      const email = req.query.email;
      const query = { sellerEmail: email };
      //have to modified
      const products = await productCollection
        .find(query)
        .project({
          productName: 1,
          price: 1,
          postDate: 1,
          isSold: 1,
        })
        .toArray();
      res.send(products);
    });
    //get bookings for a user
    app.get("/bookings", verifyJWT, async (req, res) => {
      const decoded = req.decoded;
      //console.log(req.headers.authorization);
      const email = req.query.email;
      if (decoded.email !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { userEmail: email };
      const bookings = await bookingCollection.find(query).toArray();
      res.send(bookings);
    });
    //get specific booking
    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const booking = await bookingCollection.findOne(query);
      res.send(booking);
    });

    //get users api
    app.get("/users", async (req, res) => {
      const query = {};
      const users = await userCollection.find(query).toArray();
      res.send(users);
    });
    //get admin api
    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      res.send({ isAdmin: user?.role === "admin" });
    });
    //get admin api
    app.get("/users/seller/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ isSeller: user?.role === "seller" });
    });
    app.get("/users/user/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ isUser: user?.role === "user" });
    });
    //get all buyer api
    app.get("/allbuyer", async (req, res) => {
      const query = { role: { $in: ["user"] } };
      const allbuyer = await userCollection.find(query).toArray();
      res.send(allbuyer);
    });
    //get all seller api
    app.get("/allseller", async (req, res) => {
      const query = { role: { $in: ["seller"] } };
      const allseller = await userCollection.find(query).toArray();
      res.send(allseller);
    });
    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.TOKEN_SECRET, {
          expiresIn: "1d",
        });
        res.send({ token });
      } else {
        res.status(403).send({ message: "forbidden access" });
      }
    });
    //post api
    //post booking
    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const query = {
        userEmail: booking.userEmail,
        productId: booking.productId,
      };
      const alredyBooked = await bookingCollection.findOne(query);
      if (alredyBooked) {
        return res.send({
          acknowledged: false,
          message: "You Already Booked This Product",
        });
      }

      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    });
    app.post("/products", async (req, res) => {
      const product = req.body;
      const sellerEmail = product.sellerEmail;
      const query = {
        email: sellerEmail,
      };
      const seller = await userCollection.findOne(query);

      if (seller?.verified) {
        product.sellerVerified = true;
      } else {
        product.sellerVerified = false;
      }
      const result = await productCollection.insertOne(product);
      res.send(result);
    });
    //post stripe payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;
      const amount = booking.price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        currency: "usd",
        amount: amount,
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });
    //post payment
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentCollection.insertOne(payment);
      const bookingId = payment.bookingId;
      const filter = { _id: ObjectId(bookingId) };
      const options = { upsert: true };
      const updatedDocBook = {
        $set: {
          isSold: true,
          paid: true,
        },
      };
      const updatedBooking = await bookingCollection.updateOne(
        filter,
        updatedDocBook,
        options
      );
      const productId = payment.productId;

      const query = { _id: ObjectId(productId) };
      const updatedDoc = {
        $set: {
          isSold: true,
        },
      };
      const updatedBookings = await bookingCollection.updateMany(
        query,
        updatedDoc,
        options
      );
      const updatedProduct = await productCollection.updateOne(
        query,
        updatedDoc,
        options
      );
      res.send(result);
    });
    //put api
    //put users api
    app.put("/users", async (req, res) => {
      const user = req.body;
      const filter = { email: user.email };
      const options = { upsert: true };
      const updatedDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });
    //update seller verification
    app.put("/verifySeller/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: { sellerVerified: true },
      };
      const updtaeUser = await userCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      const seller = await userCollection.findOne(filter);
      const sellerEmail = seller.email;
      const query = {
        sellerEmail: sellerEmail,
      };
      const updateProducts = await productCollection.updateMany(
        query,
        updatedDoc,
        options
      );
      res.send(updtaeUser);
    });

    //delete api
    //delete seller
    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });
  } finally {
    //server never stopped
  }
}
run().catch((error) => console.log(error));

app.get("/", (req, res) => {
  res.send("Mobile Market Server is Running.....");
});

app.listen(port, () => {
  console.log("Mobile Market Server is Running on Port ", port);
});
