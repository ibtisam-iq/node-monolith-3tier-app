// require('dotenv').config({ path: __dirname + '/../.env' }); // Load environment variables from .env file

// Import required modules
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 5000; // Set the server port

// Middleware
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(bodyParser.json()); // Parse JSON requests

// Database connection
const db = mysql.createConnection({
  host: 'db', // MySQL service name from Docker Compose
  user: 'ibtisam',
  password: 'ibtisam',
  database: 'test_db'
  // Alternative: Use environment variables for better security
  // host: process.env.DB_HOST,
  // user: process.env.MYSQL_USER,
  // password: process.env.MYSQL_PASSWORD,
  // database: process.env.MYSQL_DATABASE,
});

// Establish database connection
db.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err);
    process.exit(1); // Exit process if database connection fails
  }
  console.log('Database connected.');
});

// ✅ API Test Route (To check if the backend is running)
app.get('/api/test', (req, res) => {
  res.json({ message: "API is working!" });
});

// ✅ CRUD API Routes for users
app.get('/api/users', (req, res) => {
  db.query('SELECT * FROM users', (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(results);
  });
});

app.post('/api/users', (req, res) => {
  const { name, email, role } = req.body;
  db.query('INSERT INTO users (name, email, role) VALUES (?, ?, ?)', [name, email, role], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ id: results.insertId, name, email, role });
  });
});

app.put('/api/users/:id', (req, res) => {
  const { id } = req.params;
  const { name, email, role } = req.body;
  db.query('UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?', [name, email, role, id], (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(200).json({ id, name, email, role });
  });
});

app.delete('/api/users/:id', (req, res) => {
  const { id } = req.params;
  db.query('DELETE FROM users WHERE id = ?', [id], (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(200).json({ message: 'User deleted successfully' });
  });
});

/**
There is no Nginx, Express is responsible for: 
✅ Serving API routes (e.g., /api/users)
✅ Handling API requests (receiving requests from frontend, responding directly)
✅ Managing database interactions (e.g., CRUD operations)
✅ Serving static files (e.g., index.html)
✅ Handling errors and exceptions
✅ Running the server

In this case, the frontend must directly call http://backend:5000/api/users (Express' port).
 */

// Serve static files from the client/public directory
app.use(express.static(path.join(__dirname, '../client/public')));

// Serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public', 'index.html'));
});


// Start server
app.listen(port, () => {
  console.log(`🚀 API Server is running at http://localhost:${port}`);
});
