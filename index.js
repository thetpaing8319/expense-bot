const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Bot is running successfully!'));
app.listen(process.env.PORT || 3000, () => console.log('Web server is ready.'));
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN ကို .env ဖိုင်ထဲမှာ ထည့်မထားပါ။');

const bot = new Telegraf(process.env.BOT_TOKEN);
const prisma = new PrismaClient();

bot.start((ctx) => ctx.reply('ငွေစာရင်းမှတ် Bot မှ ကြိုဆိုပါတယ်။\nအသုံးစရိတ်သွင်းရန်: /add 5000 ထမင်းဖိုး\nဝင်ငွေသွင်းရန်: /income 50000 လစာ'));

// --- အသုံးစရိတ် (Expense) ထည့်ရန် ---
bot.command('add', async (ctx) => {
    const text = ctx.message.text.split(' ');
    if (text.length < 3) return ctx.reply('ကျေးဇူးပြု၍ ပုံစံမှန်ရိုက်ပါ။ ဥပမာ: /add 5000 ထမင်းဖိုး');

    const amount = parseFloat(text[1]);
    const category = text.slice(2).join(' ');
    const userId = ctx.from.id.toString();

    if (isNaN(amount)) return ctx.reply('ငွေပမာဏ မှားယွင်းနေပါသည်။');

    try {
        await prisma.expense.create({ data: { userId, amount, category } });
        ctx.reply(`အသုံးစရိတ်: ${category} အတွက် ${amount} ကျပ် စာရင်းသွင်းပြီးပါပြီ။ 🔴`);
    } catch (error) {
        ctx.reply('စာရင်းသွင်းရာတွင် အမှားအယွင်းဖြစ်သွားပါသည်။');
    }
});

// --- ဝင်ငွေ (Income) ထည့်ရန် ---
bot.command('income', async (ctx) => {
    const text = ctx.message.text.split(' ');
    if (text.length < 3) return ctx.reply('ကျေးဇူးပြု၍ ပုံစံမှန်ရိုက်ပါ။ ဥပမာ: /income 50000 လစာ');

    const amount = parseFloat(text[1]);
    const source = text.slice(2).join(' ');
    const userId = ctx.from.id.toString();

    if (isNaN(amount)) return ctx.reply('ငွေပမာဏ မှားယွင်းနေပါသည်။');

    try {
        await prisma.income.create({ data: { userId, amount, source } });
        ctx.reply(`ဝင်ငွေ: ${source} မှ ${amount} ကျပ် စာရင်းသွင်းပြီးပါပြီ။ 🟢`);
    } catch (error) {
        ctx.reply('စာရင်းသွင်းရာတွင် အမှားအယွင်းဖြစ်သွားပါသည်။');
    }
});

// --- Report တွက်ချက်ခြင်း (ဝင်ငွေ + ထွက်ငွေ + လက်ကျန်) ---
const getReport = async (userId, days, label) => {
    const date = new Date();
    date.setDate(date.getDate() - days);

    const expenses = await prisma.expense.findMany({ where: { userId, date: { gte: date } } });
    const incomes = await prisma.income.findMany({ where: { userId, date: { gte: date } } });

    const totalExpense = expenses.reduce((sum, item) => sum + item.amount, 0);
    const totalIncome = incomes.reduce((sum, item) => sum + item.amount, 0);
    const balance = totalIncome - totalExpense;

    return `📊 **${label} စာရင်း**\n\n🟢 ဝင်ငွေစုစုပေါင်း: ${totalIncome} ကျပ်\n🔴 သုံးငွေစုစုပေါင်း: ${totalExpense} ကျပ်\n\n💰 လက်ကျန်ငွေ: ${balance} ကျပ်`;
};

bot.command('today', async (ctx) => ctx.reply(await getReport(ctx.from.id.toString(), 1, "ယနေ့")));
bot.command('week', async (ctx) => ctx.reply(await getReport(ctx.from.id.toString(), 7, "ဒီတစ်ပတ်")));
bot.command('month', async (ctx) => ctx.reply(await getReport(ctx.from.id.toString(), 30, "ဒီတစ်လ")));

// --- Excel ဖြင့် ထုတ်ယူရန် ---
bot.command('export', async (ctx) => {
    const userId = ctx.from.id.toString();
    const expenses = await prisma.expense.findMany({ where: { userId } });
    const incomes = await prisma.income.findMany({ where: { userId } });

    if (expenses.length === 0 && incomes.length === 0) return ctx.reply('ထုတ်ယူရန် စာရင်းမရှိသေးပါ။');

    let csvContent = 'Date,Type,Category_or_Source,Amount\n';
    incomes.forEach(row => { csvContent += `${row.date.toISOString().split('T')[0]},Income,${row.source},${row.amount}\n`; });
    expenses.forEach(row => { csvContent += `${row.date.toISOString().split('T')[0]},Expense,${row.category},${row.amount}\n`; });

    ctx.replyWithDocument({ source: Buffer.from(csvContent, 'utf-8'), filename: 'Financial_Report.csv' });
});

// --- Commands အားလုံးပြရန် ---
bot.command('commands', (ctx) => {
    const helpText = `
🤖 **အသုံးပြုနိုင်သော Commands များ** 🤖

/add [ငွေ] [အကြောင်းအရာ] - အသုံးစရိတ်သွင်းရန် (ဥပမာ: /add 5000 ထမင်းဖိုး)
/income [ငွေ] [အကြောင်းအရာ] - ဝင်ငွေသွင်းရန် (ဥပမာ: /income 50000 လစာ)
/today - ယနေ့ ဝင်ငွေ/ထွက်ငွေ ကြည့်ရန်
/week - ယခုတစ်ပတ် ဝင်ငွေ/ထွက်ငွေ ကြည့်ရန်
/month - ယခုလ ဝင်ငွေ/ထွက်ငွေ ကြည့်ရန်
/export - ဝင်ငွေ/ထွက်ငွေ အားလုံးကို Excel ဖိုင်ဖြင့် ထုတ်ယူရန်
/commands - အသုံးပြုနိုင်သော Commands များကြည့်ရန်
`;
    ctx.reply(helpText);
});

bot.launch().then(() => console.log('Bot is running...')).catch(err => console.error("Bot Error:", err));