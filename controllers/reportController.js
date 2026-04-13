import Sale from '../models/Sale.js';
import Product from '../models/Product.js';

export const getDashboardStats = async (req, res) => {
  const totalProducts = await Product.countDocuments();
  const lowStockItems = await Product.countDocuments({
    $expr: { $lte: ['$quantity', '$minStockLevel'] }
  });
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todaySales = await Sale.find({
    createdAt: { $gte: today }
  });
  
  const todayRevenue = todaySales.reduce((sum, sale) => sum + sale.total, 0);
  
  res.json({
    totalProducts,
    lowStockItems,
    todaySales: todaySales.length,
    todayRevenue
  });
};

export const getSalesTrend = async (req, res) => {
  const last7Days = [];
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    
    const sales = await Sale.find({
      createdAt: { $gte: date, $lt: nextDate }
    });
    
    last7Days.push({
      date: date.toLocaleDateString('en-US', { weekday: 'short' }),
      revenue: sales.reduce((sum, sale) => sum + sale.total, 0),
      count: sales.length
    });
  }
  
  res.json(last7Days);
};