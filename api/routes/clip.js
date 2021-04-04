const express = require('express');
const clipController = require('../controllers/clip');

module.exports = (context) => {
  let router = express.Router();
  router.post('/', clipController.clip.bind(context));
  return router;
};