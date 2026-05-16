import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = process.env.APP_URL;

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN не задан');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log('Бот покерного клуба запущен...');

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'Игрок';

  await bot.sendMessage(chatId, `Добро пожаловать в покерный клуб, ${firstName}! 🃏\n\nОткрой приложение, чтобы записаться на игры и посмотреть рейтинг.`, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '🃏 Открыть клуб',
            web_app: { url: appUrl }
          }
        ]
      ]
    }
  });
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, `📖 Команды:\n\n/start — главное меню\n/help — помощь`);
});

bot.on('polling_error', (error) => {
  console.error('Ошибка polling:', error.message);
});

process.on('SIGINT', () => {
  bot.stopPolling();
  process.exit(0);
});
