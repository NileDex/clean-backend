import express from "express";
import { createServer as createViteServer } from "vite";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import path from "path";
import cors from "cors";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key";

if (!MONGODB_URI) {
  console.error("CRITICAL ERROR: MONGODB_URI environment variable is not set.");
}

const client = new MongoClient(MONGODB_URI || "mongodb://localhost:27017", {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  connectTimeoutMS: 10000,
});

// Middleware to verify admin token
const authenticateAdmin = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
};

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

  let db: any;
  let connectionError: string | null = null;

  const bootstrapAdmin = async (database: any) => {
    try {
      const adminCount = await database.collection("admins").countDocuments();
      if (adminCount === 0) {
        console.log("🚀 Bootstrapping default admin account...");
        const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
        await database.collection("admins").insertOne({
          username: "admin",
          password: hashedPassword,
          createdAt: new Date()
        });
        console.log("✅ Default admin created (Username: admin)");
      }
    } catch (err) {
      console.error("❌ Failed to bootstrap admin:", err);
    }
  };

  if (!MONGODB_URI) {
    connectionError = "CONFIGURATION_ERROR: MONGODB_URI secret is missing. Please add it to your environment variables.";
  } else {
    // Connect to MongoDB in the background
    client.connect().then(() => {
      db = client.db("ecommerce");
      connectionError = null;
      console.log("✅ MongoDB Connection Status: SUCCESS");
      bootstrapAdmin(db);
    }).catch(err => {
      connectionError = err.message;
      if (err.message.includes("auth failed") || err.message.includes("authentication failed")) {
        connectionError = "AUTHENTICATION_FAILED: The password in your MONGODB_URI is incorrect.";
      }
      console.error("❌ MongoDB Connection Status: FAILED");
      console.error("Error details:", err.message);
    });
  }

  // Root route for health check
  app.get("/", (req, res) => {
    res.json({ 
      status: "online", 
      database: db ? "connected" : "connecting/error",
      message: "CleanShop Backend API is running." 
    });
  });

  // Auth Routes
  app.post("/api/login", async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "Database connecting..." });
      const { password } = req.body;
      
      const admin = await db.collection("admins").findOne({ username: "admin" });
      
      if (!admin) {
        return res.status(401).json({ error: "Admin account not found" });
      }

      const isMatch = await bcrypt.compare(password, admin.password);
      
      if (isMatch) {
        const token = jwt.sign({ role: "admin", id: admin._id }, JWT_SECRET, { expiresIn: "24h" });
        res.json({ success: true, token });
      } else {
        res.status(401).json({ error: "Invalid password" });
      }
    } catch (err) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  // API Routes
  app.get("/api/products", async (req, res) => {
    if (connectionError) {
      return res.status(500).json({ error: "Database Connection Failed", details: connectionError });
    }
    
    if (!db) return res.status(503).json({ error: "Database is still connecting..." });

    try {
      const products = await db.collection("products").find({}).toArray();
      res.json(products);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch products" });
    }
  });

  // Protected Admin Routes
  app.get("/api/sellers", authenticateAdmin, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "Database connecting..." });
      const sellers = await db.collection("sellers").find({}).toArray();
      res.json(sellers);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch sellers" });
    }
  });

  app.post("/api/sellers", authenticateAdmin, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "Database connecting..." });
      const { name, email, whatsapp } = req.body;
      const result = await db.collection("sellers").insertOne({
        name,
        email,
        whatsapp,
        createdAt: new Date()
      });
      res.json({ success: true, id: result.insertedId });
    } catch (err) {
      res.status(500).json({ error: "Failed to create seller" });
    }
  });

  app.delete("/api/sellers/:id", authenticateAdmin, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "Database connecting..." });
      const { id } = req.params;
      await db.collection("sellers").deleteOne({ _id: new ObjectId(id) });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete seller" });
    }
  });

  // Ad Routes
  app.get("/api/ads", async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "Database connecting..." });
      const ads = await db.collection("ads").find({}).toArray();
      res.json(ads);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch ads" });
    }
  });

  app.post("/api/ads", authenticateAdmin, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "Database connecting..." });
      const { title, image, link, startDate, endDate } = req.body;
      const result = await db.collection("ads").insertOne({
        title,
        image,
        link,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        createdAt: new Date()
      });
      res.json({ success: true, id: result.insertedId });
    } catch (err) {
      res.status(500).json({ error: "Failed to create ad" });
    }
  });

  app.delete("/api/ads/:id", authenticateAdmin, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "Database connecting..." });
      const { id } = req.params;
      await db.collection("ads").deleteOne({ _id: new ObjectId(id) });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete ad" });
    }
  });

  // Ad Requests Routes
  app.post("/api/ad-requests", async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "Database connecting..." });
      const { name, email, whatsapp, details } = req.body;
      if (!name || !email || !details) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const result = await db.collection("adRequests").insertOne({
        name,
        email,
        whatsapp,
        details,
        status: 'pending',
        createdAt: new Date()
      });
      res.json({ success: true, id: result.insertedId });
    } catch (err) {
      res.status(500).json({ error: "Failed to submit ad request" });
    }
  });

  app.get("/api/ad-requests", authenticateAdmin, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "Database connecting..." });
      const requests = await db.collection("adRequests").find().sort({ createdAt: -1 }).toArray();
      res.json(requests);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch ad requests" });
    }
  });

  app.delete("/api/ad-requests/:id", authenticateAdmin, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "Database connecting..." });
      const { id } = req.params;
      await db.collection("adRequests").deleteOne({ _id: new ObjectId(id) });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete ad request" });
    }
  });

  // Product Reviews Routes
  app.get("/api/products/:id/reviews", async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "Database connecting..." });
      const { id } = req.params;
      const reviews = await db.collection("reviews").find({ productId: id }).sort({ createdAt: -1 }).toArray();
      res.json(reviews);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch reviews" });
    }
  });

  app.post("/api/products/:id/reviews", async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "Database connecting..." });
      const { id } = req.params;
      const { userName, comment, rating } = req.body;
      if (!userName || !comment || !rating) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const result = await db.collection("reviews").insertOne({
        productId: id,
        userName,
        comment,
        rating: Number(rating),
        createdAt: new Date()
      });
      res.json({ success: true, id: result.insertedId });
    } catch (err) {
      res.status(500).json({ error: "Failed to post review" });
    }
  });

  // Protected Admin Routes
  app.post("/api/products", authenticateAdmin, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "Database connecting..." });
      const { name, description, fullInfo, price, images, image, inStock, sellerId } = req.body;
      
      let sellerInfo = null;
      if (sellerId) {
        sellerInfo = await db.collection("sellers").findOne({ _id: new ObjectId(sellerId) });
      }

      // Handle both single image (legacy) and multiple images
      const productImages = Array.isArray(images) ? images : (image ? [image] : []);

      if (productImages.length < 3) {
        return res.status(400).json({ error: "At least 3 images are required for new products." });
      }

      const result = await db.collection("products").insertOne({
        name,
        description,
        fullInfo,
        price: parseFloat(price),
        images: productImages,
        image: productImages[0] || null, // Keep single image for backward compatibility
        inStock: inStock === true || inStock === 'true',
        sellerId: sellerId ? new ObjectId(sellerId) : null,
        seller: sellerInfo ? {
          name: sellerInfo.name,
          email: sellerInfo.email,
          whatsapp: sellerInfo.whatsapp
        } : null,
        createdAt: new Date()
      });
      res.json({ success: true, id: result.insertedId });
    } catch (err) {
      res.status(500).json({ error: "Failed to create product" });
    }
  });

  app.put("/api/products/:id", authenticateAdmin, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "Database connecting..." });
      const { id } = req.params;
      const { inStock } = req.body;
      await db.collection("products").updateOne(
        { _id: new ObjectId(id) },
        { $set: { inStock: inStock === true } }
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to update product" });
    }
  });

  app.delete("/api/products/:id", authenticateAdmin, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "Database connecting..." });
      const { id } = req.params;
      await db.collection("products").deleteOne({ _id: new ObjectId(id) });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete product" });
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
