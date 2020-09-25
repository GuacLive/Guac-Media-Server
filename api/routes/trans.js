const express = require('express');
const transController = require('../controllers/trans');

module.exports = (context) => {
  let router = express.Router();
  router.get('/', transController.getTrans.bind(context));
  router.post('/', transController.addTrans.bind(context));
  router.delete('/', transController.deleteTrans.bind(context));
  return router;
};
