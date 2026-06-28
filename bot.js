import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = process.env.APP_URL;

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN не задан — бот не запущен');
  // не exit, чтобы server.js работал локально без бота
}

console.log('APP_URL:', appUrl);

const bot = token ? new TelegramBot(token, { polling: true }) : null;
if (bot) console.log('Бот покерного клуба запущен...');

// Глобальная ссылка, чтобы challenges.js мог слать уведомления без прямого импорта bot.js
globalThis.__prideBot = bot;

export { bot };

if (bot) bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'Игрок';

  try {
    if (!appUrl) {
      await bot.sendMessage(chatId, `Добро пожаловать в покерный клуб, ${firstName}! 🃏\n\n⚙️ Приложение ещё настраивается, попробуй позже.`);
      return;
    }

    await bot.sendMessage(chatId, `Добро пожаловать в покерный клуб PRIDE!\nОткрой приложение для просмотра рейтинга и статистики участников!`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🃏 Открыть клуб', web_app: { url: appUrl } }]
        ]
      }
    });
  } catch (error) {
    console.error('Ошибка /start:', error.message);
    await bot.sendMessage(chatId, 'Произошла ошибка, попробуй ещё раз.').catch(() => {});
  }
});

if (bot) bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, `📖 Команды:\n\n/start — главное меню\n/help — помощь`);
});

if (bot) bot.on('polling_error', (error) => {
  console.error('Ошибка polling:', error.message);
});

process.on('SIGINT', () => {
  if (bot) bot.stopPolling();
  process.exit(0);
});
