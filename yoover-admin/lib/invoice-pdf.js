import PDFDocument from 'pdfkit';

const formatCurrency = amount =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(amount) || 0);

const formatDate = value => {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date);
};

export default details =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50
    });

    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const accent = '#0f766e';
    const text = '#17324d';
    const soft = '#5f7288';
    const border = '#dbe4ee';
    const wash = '#effaf8';

    doc.rect(0, 0, doc.page.width, 120).fill(accent);

    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(28).text('Yoover Invoice', 50, 42);
    doc.font('Helvetica').fontSize(11).text(`Invoice ${details.invoiceNumber || 'Pending'}`, 50, 78);

    doc.roundedRect(50, 140, 495, 112, 18).fillAndStroke(wash, border);

    doc.fillColor(text).font('Helvetica-Bold').fontSize(12).text('Billed To', 72, 162);
    doc.font('Helvetica').fontSize(13).text(details.fullName || '-', 72, 184);
    doc.fillColor(soft).fontSize(11).text(details.billingEmail || '-', 72, 204);
    doc.text(details.emailAddress || '-', 72, 220);

    doc.fillColor(text).font('Helvetica-Bold').fontSize(12).text('Invoice Details', 332, 162);
    doc.font('Helvetica').fontSize(11).fillColor(soft);
    doc.text(`Issued: ${formatDate(details.createdAt)}`, 332, 184);
    doc.text(`Plan: ${details.planName || '-'}`, 332, 202);
    doc.text(`Transaction: ${details.transactionId || 'Pending'}`, 332, 220, {
      width: 170
    });

    doc.fillColor(text).font('Helvetica-Bold').fontSize(12).text('Summary', 50, 286);

    const tableTop = 316;
    const tableLeft = 50;
    const tableWidth = 495;
    const descriptionWidth = 290;
    const amountWidth = 120;
    const statusWidth = 85;

    doc.roundedRect(tableLeft, tableTop, tableWidth, 42, 12).fillAndStroke('#f8fbff', border);

    doc.fillColor(text).font('Helvetica-Bold').fontSize(11);
    doc.text('Description', tableLeft + 18, tableTop + 15, { width: descriptionWidth });
    doc.text('Amount', tableLeft + descriptionWidth + 30, tableTop + 15, { width: amountWidth });
    doc.text('Status', tableLeft + descriptionWidth + amountWidth + 30, tableTop + 15, { width: statusWidth });

    const rowTop = tableTop + 54;
    doc.roundedRect(tableLeft, rowTop, tableWidth, 58, 12).fillAndStroke('#ffffff', border);

    doc.fillColor(text).font('Helvetica').fontSize(11);
    doc.text(`${details.planName || 'Yoover plan'} for ${details.emailAddress || 'new mailbox'}`, tableLeft + 18, rowTop + 16, {
      width: descriptionWidth
    });
    doc.text(formatCurrency(details.amount), tableLeft + descriptionWidth + 30, rowTop + 20, { width: amountWidth });
    doc.fillColor(accent).font('Helvetica-Bold').text(details.paymentStatus || 'Paid', tableLeft + descriptionWidth + amountWidth + 30, rowTop + 20, {
      width: statusWidth
    });

    const totalTop = rowTop + 90;
    doc.fillColor(text).font('Helvetica-Bold').fontSize(15).text('Total Paid', 360, totalTop);
    doc.fontSize(22).fillColor(accent).text(formatCurrency(details.amount), 360, totalTop + 24);

    doc.fillColor(soft).font('Helvetica').fontSize(10).text(
      'This invoice confirms the initial payment captured for your Yoover mailbox setup.',
      50,
      710,
      { width: 495, align: 'center' }
    );

    doc.end();
  });
