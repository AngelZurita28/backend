// db.js
const neo4j = require("neo4j-driver");
require("dotenv").config();

const uri = process.env.NEO4J_URI;
const user = process.env.NEO4J_USER;
const password = process.env.NEO4J_PASSWORD;

// Creamos una única instancia del driver
const driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
  encrypted: false, // <-- La línea clave para desactivar la encriptación
});

// Exportamos el driver para usarlo en otros archivos
module.exports = driver;
