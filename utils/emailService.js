const { createTransporter } = require('../config/email');

// ─── Email Templates ──────────────────────────────────────────────────────────

const lowStockEmailTemplate = (products) => {
  const rows = products
    .map(
      (p) => `
      <tr style="border-bottom:1px solid #eee">
        <td style="padding:10px">${p.name}</td>
        <td style="padding:10px;color:#666">${p.sku}</td>
        <td style="padding:10px;color:#e53e3e;font-weight:bold">${p.quantity}</td>
        <td style="padding:10px;color:#666">${p.minStockLevel}</td>
        <td style="padding:10px;text-transform:capitalize">${p.category}</td>
      </tr>`
    )
    .join('');

  return {
    subject: `Low Stock Alert – ${products.length} item(s) need restocking`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;background:#f9f9f9;padding:20px;border-radius:8px">
        <div style="background:#0B7B44;padding:20px;border-radius:8px 8px 0 0;text-align:center">
          <h1 style="color:white;margin:0;font-size:22px">Tiana Agrovet  Low Stock Alert</h1>
        </div>
        <div style="background:white;padding:24px;border-radius:0 0 8px 8px">
          <p style="color:#333;font-size:16px">The following <strong>${products.length}</strong> product(s) have fallen below their minimum stock threshold and require immediate restocking:</p>
          <table style="width:100%;border-collapse:collapse;margin-top:16px">
            <thead>
              <tr style="background:#f0fdf4;text-align:left">
                <th style="padding:10px;color:#0B7B44">Product</th>
                <th style="padding:10px;color:#0B7B44">SKU</th>
                <th style="padding:10px;color:#0B7B44">Current Qty</th>
                <th style="padding:10px;color:#0B7B44">Min Level</th>
                <th style="padding:10px;color:#0B7B44">Category</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="margin-top:24px;color:#555">Please review and place orders with your suppliers to avoid stockouts.</p>
          <p style="color:#999;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:16px">
            This is an automated notification from Tiana Agrovet. Generated at ${new Date().toLocaleString()}.
          </p>
        </div>
      </div>`,
  };
};

const expiryAlertEmailTemplate = (products) => {
  const rows = products
    .map((p) => {
      const days = p.daysUntilExpiry;
      const color = days <= 7 ? '#e53e3e' : days <= 14 ? '#dd6b20' : '#d69e2e';
      return `
      <tr style="border-bottom:1px solid #eee">
        <td style="padding:10px">${p.name}</td>
        <td style="padding:10px;color:#666">${p.sku}</td>
        <td style="padding:10px">${p.batchNumber || '—'}</td>
        <td style="padding:10px">${p.quantity}</td>
        <td style="padding:10px">${new Date(p.expiryDate).toLocaleDateString()}</td>
        <td style="padding:10px;font-weight:bold;color:${color}">${days} days</td>
      </tr>`;
    })
    .join('');

  return {
    subject: `Product Expiry Alert – ${products.length} item(s) expiring soon`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;background:#f9f9f9;padding:20px;border-radius:8px">
        <div style="background:#c05621;padding:20px;border-radius:8px 8px 0 0;text-align:center">
          <h1 style="color:white;margin:0;font-size:22px">Tiana Agrovet  Expiry Warning</h1>
        </div>
        <div style="background:white;padding:24px;border-radius:0 0 8px 8px">
          <p style="color:#333;font-size:16px">The following <strong>${products.length}</strong> product(s) are expiring within <strong>30 days</strong>:</p>
          <table style="width:100%;border-collapse:collapse;margin-top:16px">
            <thead>
              <tr style="background:#fff5f5;text-align:left">
                <th style="padding:10px;color:#c05621">Product</th>
                <th style="padding:10px;color:#c05621">SKU</th>
                <th style="padding:10px;color:#c05621">Batch</th>
                <th style="padding:10px;color:#c05621">Qty</th>
                <th style="padding:10px;color:#c05621">Expiry Date</th>
                <th style="padding:10px;color:#c05621">Days Left</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div style="margin-top:20px;padding:16px;background:#fff5f5;border-left:4px solid #c05621;border-radius:4px">
            <strong>Action required:</strong> Review these products and consider markdowns, promotions, or returns to your supplier.
          </div>
          <p style="color:#999;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:16px">
            This is an automated notification from Tiana Agrovet. Generated at ${new Date().toLocaleString()}.
          </p>
        </div>
      </div>`,
  };
};

const autoOrderEmailTemplate = (order, supplier) => {
  const rows = order.items
    .map(
      (item) => `
      <tr style="border-bottom:1px solid #eee">
        <td style="padding:10px">${item.productName}</td>
        <td style="padding:10px;text-align:center">${item.quantity}</td>
        <td style="padding:10px;text-align:right">KSh ${item.unitPrice.toLocaleString()}</td>
        <td style="padding:10px;text-align:right;font-weight:bold">KSh ${(item.quantity * item.unitPrice).toLocaleString()}</td>
      </tr>`
    )
    .join('');

  return {
    subject: `Auto Purchase Order – #${order._id.toString().slice(-8).toUpperCase()}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;background:#f9f9f9;padding:20px;border-radius:8px">
        <div style="background:#2b6cb0;padding:20px;border-radius:8px 8px 0 0;text-align:center">
          <h1 style="color:white;margin:0;font-size:22px"> Tiana Agrovet Purchase Order</h1>
          <p style="color:#bee3f8;margin:4px 0 0">Auto-generated due to low stock</p>
        </div>
        <div style="background:white;padding:24px;border-radius:0 0 8px 8px">
          <div style="display:flex;justify-content:space-between;margin-bottom:20px">
            <div>
              <strong>Supplier:</strong> ${supplier.name}<br/>
              <strong>Contact:</strong> ${supplier.phone}<br/>
              ${supplier.email ? `<strong>Email:</strong> ${supplier.email}` : ''}
            </div>
            <div style="text-align:right">
              <strong>Order #:</strong> ${order._id.toString().slice(-8).toUpperCase()}<br/>
              <strong>Date:</strong> ${new Date().toLocaleDateString()}<br/>
              <strong>Status:</strong> <span style="color:#2b6cb0">Pending Confirmation</span>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:#ebf8ff;text-align:left">
                <th style="padding:10px;color:#2b6cb0">Product</th>
                <th style="padding:10px;color:#2b6cb0;text-align:center">Qty</th>
                <th style="padding:10px;color:#2b6cb0;text-align:right">Unit Price</th>
                <th style="padding:10px;color:#2b6cb0;text-align:right">Total</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr style="background:#f7fafc">
                <td colspan="3" style="padding:10px;font-weight:bold;text-align:right">Grand Total:</td>
                <td style="padding:10px;font-weight:bold;font-size:16px;color:#2b6cb0;text-align:right">KSh ${order.totalAmount.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
          <div style="margin-top:20px;padding:16px;background:#ebf8ff;border-left:4px solid #2b6cb0;border-radius:4px">
            This order was automatically generated by Tiana Agrovet due to low stock levels. Please confirm or contact us to adjust quantities.
          </div>
          <p style="color:#999;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:16px">
            Tiana Agrovet  ${new Date().toLocaleString()}
          </p>
        </div>
      </div>`,
  };
};

// ─── Send Functions ───────────────────────────────────────────────────────────

const sendEmail = async ({ to, subject, html }) => {
  const transporter = createTransporter();
  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
  });
  return info;
};

const addRecipient = (recipients, email) => {
  const normalized = String(email || '').trim();
  if (normalized && !recipients.includes(normalized)) {
    recipients.push(normalized);
  }
};

const buildAlertRecipients = (products = []) => {
  const recipients = [];
  addRecipient(recipients, process.env.ALERT_EMAIL);

  for (const product of products) {
    addRecipient(recipients, product?.supplierId?.email);
  }

  if (!recipients.length) {
    throw new Error('No recipient email configured (set ALERT_EMAIL or ensure low stock products have suppliers with email addresses).');
  }

  return recipients;
};

const sendLowStockAlert = async (products) => {
  if (!products.length) return null;
  const { subject, html } = lowStockEmailTemplate(products);
  const recipients = buildAlertRecipients(products);
  return sendEmail({ to: recipients.join(','), subject, html });
};

const sendExpiryAlert = async (products) => {
  if (!products.length) return null;
  const { subject, html } = expiryAlertEmailTemplate(products);
  return sendEmail({ to: process.env.ALERT_EMAIL, subject, html });
};

const sendAutoOrderEmail = async (order, supplier) => {
  const { subject, html } = autoOrderEmailTemplate(order, supplier);

  // Build recipients safely (ignore empty env / empty supplier email)
  const recipients = [];
  addRecipient(recipients, process.env.ALERT_EMAIL);
  addRecipient(recipients, supplier?.email);

  if (!recipients.length) {
    throw new Error('No recipient email configured (set ALERT_EMAIL or ensure supplier.email is set).');
  }

  return sendEmail({ to: recipients.join(','), subject, html });
};

module.exports = {
  sendEmail,
  sendLowStockAlert,
  sendExpiryAlert,
  sendAutoOrderEmail,
};
