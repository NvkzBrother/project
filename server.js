const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'shift-scheduler-secret-2024';

// ==================== TELEGRAM CONFIG ====================
const TELEGRAM_BOT_TOKEN = '8431820910:AAH3d5jRqieyMc_aBIi2OFDj6AhIWVg2fuU';

// Названия месяцев
const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTH_NAMES_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const DAY_NAMES = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

// ==================== MONGODB ====================

const MONGODB_URI = process.env.MONGODB_URI || 'ваша_строка_подключения_сюда';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB подключена'))
    .catch(err => console.error('❌ Ошибка MongoDB:', err));

// Схемы MongoDB
const SettingsSchema = new mongoose.Schema({
    key: { type: String, unique: true },
    adminUsername: String,
    adminPassword: String,
    adminName: String
});

const EmployeeSchema = new mongoose.Schema({
    name: String,
    color: String,
    createdAt: { type: Date, default: Date.now }
});

const ShiftSchema = new mongoose.Schema({
    key: { type: String, unique: true },
    type: String,
    hours: Number,
    cleaning: String
});

const TelegramSubscriptionSchema = new mongoose.Schema({
    chatId: { type: String, unique: true },
    username: String,
    firstName: String,
    subscribedTo: { type: [String], default: ['all'] },
    notifyNewEmployee: { type: Boolean, default: true },
    notifyDeleteEmployee: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

const Settings = mongoose.model('Settings', SettingsSchema);
const Employee = mongoose.model('Employee', EmployeeSchema);
const Shift = mongoose.model('Shift', ShiftSchema);
const TelegramSubscription = mongoose.model('TelegramSubscription', TelegramSubscriptionSchema);

// ==================== TELEGRAM FUNCTIONS ====================

async function sendTelegramTo(chatId, message, keyboard = null) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const body = {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        };
        
        if (keyboard) {
            body.reply_markup = keyboard;
        }
        
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (err) {
        console.error('Telegram error:', err.message);
    }
}

async function editTelegramMessage(chatId, messageId, message, keyboard = null) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;
        const body = {
            chat_id: chatId,
            message_id: messageId,
            text: message,
            parse_mode: 'HTML'
        };
        
        if (keyboard) {
            body.reply_markup = keyboard;
        }
        
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (err) {
        console.error('Edit message error:', err.message);
    }
}

async function notifySubscribers(employeeId, employeeName, message) {
    try {
        const subscriptions = await TelegramSubscription.find({ active: true });
        
        for (const sub of subscriptions) {
            const isSubscribed = sub.subscribedTo.includes('all') || 
                                 sub.subscribedTo.includes(employeeId);
            
            if (isSubscribed) {
                await sendTelegramTo(sub.chatId, message);
            }
        }
    } catch (err) {
        console.error('Notify error:', err.message);
    }
}

async function notifyShiftChange(employeeId, employeeName, dateStr, data, action) {
    let emoji = '📝';
    let actionText = 'изменена';
    
    if (action === 'created') { emoji = '✅'; actionText = 'добавлена'; }
    else if (action === 'deleted') { emoji = '❌'; actionText = 'удалена'; }
    
    let shiftInfo = '';
    if (data) {
        if (data.type === 'work') {
            shiftInfo = `🕐 ${data.hours} часов`;
            if (data.cleaning === 'cleaning') shiftInfo += ' + уборка';
            else if (data.cleaning === 'fullCleaning') shiftInfo += ' + полная уборка';
        } else if (data.type === 'off') shiftInfo = '🏠 Выходной';
        else if (data.type === 'vacation') shiftInfo = '🏖️ Отпуск';
        else if (data.type === 'sick') shiftInfo = '🏥 Больничный';
    }
    
    const message = `${emoji} <b>Смена ${actionText}</b>

👤 Сотрудник: <b>${employeeName}</b>
📅 Дата: <b>${dateStr}</b>
${shiftInfo ? '📋 ' + shiftInfo : ''}`;

    await notifySubscribers(employeeId, employeeName, message);
}

async function notifyNewEmployee(employeeName) {
    try {
        const subscriptions = await TelegramSubscription.find({ 
            active: true, 
            notifyNewEmployee: true 
        });
        
        const message = `👤 <b>Новый сотрудник</b>\n\nДобавлен: <b>${employeeName}</b>`;
        
        for (const sub of subscriptions) {
            await sendTelegramTo(sub.chatId, message);
        }
    } catch (err) {
        console.error('Notify error:', err.message);
    }
}

async function notifyDeleteEmployee(employeeName) {
    try {
        const subscriptions = await TelegramSubscription.find({ 
            active: true, 
            notifyDeleteEmployee: true 
        });
        
        const message = `🗑️ <b>Сотрудник удалён</b>\n\nУдалён: <b>${employeeName}</b>`;
        
        for (const sub of subscriptions) {
            await sendTelegramTo(sub.chatId, message);
        }
    } catch (err) {
        console.error('Notify error:', err.message);
    }
}

// ==================== SCHEDULE FUNCTIONS ====================

function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

function getDayOfWeek(year, month, day) {
    return new Date(year, month, day).getDay();
}

function getShiftEmoji(shift) {
    if (!shift) return '⬜';
    if (shift.type === 'work') {
        if (shift.cleaning === 'fullCleaning') return '🟪';
        if (shift.cleaning === 'cleaning') return '🟣';
        return '🟦';
    }
    if (shift.type === 'off') return '⬛';
    if (shift.type === 'vacation') return '🟩';
    if (shift.type === 'sick') return '🟥';
    return '⬜';
}

function getShiftText(shift) {
    if (!shift) return '-';
    if (shift.type === 'work') {
        let text = `${shift.hours}ч`;
        if (shift.cleaning === 'cleaning') text += '+У';
        if (shift.cleaning === 'fullCleaning') text += '+ПУ';
        return text;
    }
    if (shift.type === 'off') return 'Вых';
    if (shift.type === 'vacation') return 'Отп';
    if (shift.type === 'sick') return 'Бол';
    return '-';
}

async function buildScheduleMessage(empId, year, month) {
    const employee = await Employee.findById(empId);
    if (!employee) return { message: '❌ Сотрудник не найден', keyboard: null };
    
    const days = getDaysInMonth(year, month);
    const today = new Date();
    
    // Получаем все смены сотрудника за месяц
    const shifts = await Shift.find({
        key: { $regex: `^${empId}_${year}-${month}-` }
    });
    
    const shiftsMap = {};
    shifts.forEach(s => {
        shiftsMap[s.key] = s;
    });
    
    // Статистика
    let totalHours = 0;
    let totalShifts = 0;
    let totalCleaning = 0;
    let totalFullCleaning = 0;
    let totalOff = 0;
    let totalVacation = 0;
    let totalSick = 0;
    
    // Строим календарь
    let calendar = '';
    
    // Заголовок недели
    calendar += '<code>Пн Вт Ср Чт Пт Сб Вс</code>\n';
    
    // Определяем день недели первого числа (0 = Вс, 1 = Пн, ...)
    let firstDayOfWeek = getDayOfWeek(year, month, 1);
    // Преобразуем: Вс=0 -> 6, Пн=1 -> 0, и т.д.
    firstDayOfWeek = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
    
    // Пустые ячейки до первого дня
    let weekLine = '';
    for (let i = 0; i < firstDayOfWeek; i++) {
        weekLine += '   ';
    }
    
    // Дни месяца
    for (let d = 1; d <= days; d++) {
        const key = `${empId}_${year}-${month}-${d}`;
        const shift = shiftsMap[key];
        
        // Статистика
        if (shift) {
            if (shift.type === 'work') {
                totalShifts++;
                totalHours += shift.hours || 0;
                if (shift.cleaning === 'cleaning') totalCleaning++;
                if (shift.cleaning === 'fullCleaning') totalFullCleaning++;
            } else if (shift.type === 'off') totalOff++;
            else if (shift.type === 'vacation') totalVacation++;
            else if (shift.type === 'sick') totalSick++;
        }
        
        const emoji = getShiftEmoji(shift);
        const dayStr = d.toString().padStart(2, ' ');
        
        // Проверяем, сегодня ли это
        const isToday = today.getDate() === d && 
                        today.getMonth() === month && 
                        today.getFullYear() === year;
        
        if (isToday) {
            weekLine += `[${emoji}]`;
        } else {
            weekLine += `${emoji} `;
        }
        
        // Переход на новую строку в конце недели
        const dayOfWeek = getDayOfWeek(year, month, d);
        if (dayOfWeek === 0) { // Воскресенье
            calendar += `<code>${weekLine}</code>\n`;
            weekLine = '';
        }
    }
    
    // Добавляем последнюю неполную неделю
    if (weekLine) {
        calendar += `<code>${weekLine}</code>\n`;
    }
    
    // Легенда
    const legend = `
🟦 Работа  🟣 +Уборка  🟪 +Полная
⬛ Выходной  🟩 Отпуск  🟥 Больничный`;
    
    // Статистика
    const stats = `
📊 <b>Статистика:</b>
• Смен: <b>${totalShifts}</b>
• Часов: <b>${totalHours}</b>
• Уборок: <b>${totalCleaning}</b> | Полных: <b>${totalFullCleaning}</b>
• Выходных: ${totalOff} | Отпуск: ${totalVacation} | Больничных: ${totalSick}`;
    
    const message = `📅 <b>${employee.name}</b>
<b>${MONTH_NAMES[month]} ${year}</b>

${calendar}
${legend}
${stats}`;
    
    // Кнопки навигации
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    
    const keyboard = {
        inline_keyboard: [
            [
                { text: `◀️ ${MONTH_NAMES_SHORT[prevMonth]}`, callback_data: `schedule_${empId}_${prevYear}_${prevMonth}` },
                { text: '📅 Сегодня', callback_data: `schedule_${empId}_${today.getFullYear()}_${today.getMonth()}` },
                { text: `${MONTH_NAMES_SHORT[nextMonth]} ▶️`, callback_data: `schedule_${empId}_${nextYear}_${nextMonth}` }
            ],
            [
                { text: '👥 Другой сотрудник', callback_data: 'schedule_select' },
                { text: '🔙 Меню', callback_data: 'main_menu' }
            ]
        ]
    };
    
    return { message, keyboard };
}

async function buildEmployeeSelectKeyboard() {
    const employees = await Employee.find().sort({ name: 1 });
    
    if (employees.length === 0) {
        return {
            message: '📋 Список сотрудников пуст',
            keyboard: null
        };
    }
    
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    
    const keyboard = {
        inline_keyboard: employees.map(emp => ([{
            text: `👤 ${emp.name}`,
            callback_data: `schedule_${emp._id.toString()}_${year}_${month}`
        }]))
    };
    
    keyboard.inline_keyboard.push([{
        text: '🔙 Меню',
        callback_data: 'main_menu'
    }]);
    
    return {
        message: '👥 <b>Выберите сотрудника:</b>',
        keyboard
    };
}

// ==================== TELEGRAM BOT COMMANDS ====================

async function handleBotCommand(chatId, text, from) {
    const command = text.toLowerCase().trim();
    
    // /start - Начало работы
    if (command === '/start') {
        let sub = await TelegramSubscription.findOne({ chatId: chatId.toString() });
        
        if (!sub) {
            sub = new TelegramSubscription({
                chatId: chatId.toString(),
                username: from.username || '',
                firstName: from.first_name || 'Пользователь',
                subscribedTo: ['all'],
                active: true
            });
            await sub.save();
        } else {
            sub.active = true;
            await sub.save();
        }
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '📅 Просмотр графика', callback_data: 'schedule_select' }],
                [{ text: '🔔 Настройки уведомлений', callback_data: 'notifications' }],
                [{ text: '⚙️ Мои настройки', callback_data: 'settings' }]
            ]
        };
        
        await sendTelegramTo(chatId, `👋 Привет, <b>${from.first_name || 'друг'}</b>!

Я бот для просмотра графика смен.

<b>Что я умею:</b>
📅 Показывать график сотрудников
🔔 Уведомлять об изменениях смен
⚙️ Настраивать подписки

<b>Команды:</b>
/schedule — просмотр графика
/list — настройка уведомлений
/settings — мои настройки
/help — помощь`, keyboard);
        return;
    }
    
    // /help - Помощь
    if (command === '/help') {
        await sendTelegramTo(chatId, `📖 <b>Помощь</b>

<b>Просмотр графика:</b>
/schedule — выбрать сотрудника и смотреть график
• Листайте месяцы кнопками ◀️ ▶️
• Нажмите "Сегодня" для текущего месяца

<b>Уведомления:</b>
/list — выбрать от кого получать уведомления
/subscribe — подписаться на всех
/unsubscribe — отписаться от всех
/stop — отключить все уведомления

<b>Обозначения в графике:</b>
🟦 Работа
🟣 Работа + уборка
🟪 Работа + полная уборка
⬛ Выходной
🟩 Отпуск
🟥 Больничный
⬜ Не заполнено`);
        return;
    }
    
    // /schedule - Просмотр графика
    if (command === '/schedule') {
        const { message, keyboard } = await buildEmployeeSelectKeyboard();
        await sendTelegramTo(chatId, message, keyboard);
        return;
    }
    
    // /list - Список сотрудников для подписки
    if (command === '/list') {
        const employees = await Employee.find().sort({ name: 1 });
        const sub = await TelegramSubscription.findOne({ chatId: chatId.toString() });
        
        if (employees.length === 0) {
            await sendTelegramTo(chatId, '📋 Список сотрудников пуст');
            return;
        }
        
        let message = '🔔 <b>Настройка уведомлений</b>\n\n';
        message += 'Выберите, от кого получать уведомления:\n';
        
        const keyboard = {
            inline_keyboard: []
        };
        
        const isAllSubscribed = sub && sub.subscribedTo.includes('all');
        keyboard.inline_keyboard.push([{
            text: `${isAllSubscribed ? '✅' : '⬜'} Все сотрудники`,
            callback_data: `toggle_all`
        }]);
        
        for (const emp of employees) {
            const isSubscribed = sub && (
                sub.subscribedTo.includes('all') || 
                sub.subscribedTo.includes(emp._id.toString())
            );
            
            keyboard.inline_keyboard.push([{
                text: `${isSubscribed ? '✅' : '⬜'} ${emp.name}`,
                callback_data: `toggle_${emp._id.toString()}`
            }]);
        }
        
        keyboard.inline_keyboard.push([{
            text: '🔙 Меню',
            callback_data: 'main_menu'
        }]);
        
        await sendTelegramTo(chatId, message, keyboard);
        return;
    }
    
    // /settings - Текущие настройки
    if (command === '/settings') {
        const sub = await TelegramSubscription.findOne({ chatId: chatId.toString() });
        
        if (!sub) {
            await sendTelegramTo(chatId, '⚠️ Вы не зарегистрированы. Напишите /start');
            return;
        }
        
        let subscribedText = '';
        if (sub.subscribedTo.includes('all')) {
            subscribedText = '👥 Все сотрудники';
        } else if (sub.subscribedTo.length === 0) {
            subscribedText = '❌ Никто';
        } else {
            const employees = await Employee.find({ 
                _id: { $in: sub.subscribedTo } 
            });
            subscribedText = employees.map(e => `• ${e.name}`).join('\n');
        }
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '🔔 Изменить подписки', callback_data: 'notifications' }],
                [{ text: '🔙 Меню', callback_data: 'main_menu' }]
            ]
        };
        
        await sendTelegramTo(chatId, `⚙️ <b>Ваши настройки</b>

📢 <b>Подписки на уведомления:</b>
${subscribedText}

🔔 <b>Типы уведомлений:</b>
${sub.notifyNewEmployee ? '✅' : '❌'} Новые сотрудники
${sub.notifyDeleteEmployee ? '✅' : '❌'} Удаление сотрудников
${sub.active ? '✅' : '❌'} Уведомления активны`, keyboard);
        return;
    }
    
    // /subscribe - Подписаться на всех
    if (command === '/subscribe') {
        await TelegramSubscription.findOneAndUpdate(
            { chatId: chatId.toString() },
            { subscribedTo: ['all'], active: true },
            { upsert: true }
        );
        await sendTelegramTo(chatId, '✅ Вы подписались на <b>всех сотрудников</b>');
        return;
    }
    
    // /unsubscribe - Отписаться от всех
    if (command === '/unsubscribe') {
        await TelegramSubscription.findOneAndUpdate(
            { chatId: chatId.toString() },
            { subscribedTo: [] }
        );
        await sendTelegramTo(chatId, '❌ Вы отписались от всех сотрудников');
        return;
    }
    
    // /stop - Отключить уведомления
    if (command === '/stop') {
        await TelegramSubscription.findOneAndUpdate(
            { chatId: chatId.toString() },
            { active: false }
        );
        await sendTelegramTo(chatId, '🔕 Уведомления отключены.\n\nНапишите /start чтобы включить снова.');
        return;
    }
    
    // Неизвестная команда
    const keyboard = {
        inline_keyboard: [
            [{ text: '📅 Просмотр графика', callback_data: 'schedule_select' }],
            [{ text: '🔔 Уведомления', callback_data: 'notifications' }]
        ]
    };
    
    await sendTelegramTo(chatId, '❓ Неизвестная команда.\n\nВыберите действие:', keyboard);
}

// Обработка нажатий на кнопки
async function handleCallback(chatId, data, messageId, from) {
    
    // Главное меню
    if (data === 'main_menu') {
        const keyboard = {
            inline_keyboard: [
                [{ text: '📅 Просмотр графика', callback_data: 'schedule_select' }],
                [{ text: '🔔 Настройки уведомлений', callback_data: 'notifications' }],
                [{ text: '⚙️ Мои настройки', callback_data: 'settings' }]
            ]
        };
        
        await editTelegramMessage(chatId, messageId, `👋 <b>Главное меню</b>

Выберите действие:`, keyboard);
        return;
    }
    
    // Выбор сотрудника для просмотра графика
    if (data === 'schedule_select') {
        const { message, keyboard } = await buildEmployeeSelectKeyboard();
        await editTelegramMessage(chatId, messageId, message, keyboard);
        return;
    }
    
    // Просмотр графика сотрудника
    if (data.startsWith('schedule_') && data !== 'schedule_select') {
        const parts = data.split('_');
        const empId = parts[1];
        const year = parseInt(parts[2]);
        const month = parseInt(parts[3]);
        
        const { message, keyboard } = await buildScheduleMessage(empId, year, month);
        await editTelegramMessage(chatId, messageId, message, keyboard);
        return;
    }
    
    // Настройки уведомлений
    if (data === 'notifications') {
        const employees = await Employee.find().sort({ name: 1 });
        const sub = await TelegramSubscription.findOne({ chatId: chatId.toString() });
        
        let message = '🔔 <b>Настройка уведомлений</b>\n\n';
        message += 'Выберите, от кого получать уведомления:\n';
        
        const keyboard = {
            inline_keyboard: []
        };
        
        const isAllSubscribed = sub && sub.subscribedTo.includes('all');
        keyboard.inline_keyboard.push([{
            text: `${isAllSubscribed ? '✅' : '⬜'} Все сотрудники`,
            callback_data: `toggle_all`
        }]);
        
        for (const emp of employees) {
            const isSubscribed = sub && (
                sub.subscribedTo.includes('all') || 
                sub.subscribedTo.includes(emp._id.toString())
            );
            
            keyboard.inline_keyboard.push([{
                text: `${isSubscribed ? '✅' : '⬜'} ${emp.name}`,
                callback_data: `toggle_${emp._id.toString()}`
            }]);
        }
        
        keyboard.inline_keyboard.push([{
            text: '🔙 Меню',
            callback_data: 'main_menu'
        }]);
        
        await editTelegramMessage(chatId, messageId, message, keyboard);
        return;
    }
    
    // Мои настройки
    if (data === 'settings') {
        const sub = await TelegramSubscription.findOne({ chatId: chatId.toString() });
        
        let subscribedText = '';
        if (!sub || sub.subscribedTo.includes('all')) {
            subscribedText = '👥 Все сотрудники';
        } else if (sub.subscribedTo.length === 0) {
            subscribedText = '❌ Никто';
        } else {
            const employees = await Employee.find({ 
                _id: { $in: sub.subscribedTo } 
            });
            subscribedText = employees.map(e => `• ${e.name}`).join('\n');
        }
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '🔔 Изменить подписки', callback_data: 'notifications' }],
                [{ text: '🔙 Меню', callback_data: 'main_menu' }]
            ]
        };
        
        await editTelegramMessage(chatId, messageId, `⚙️ <b>Ваши настройки</b>

📢 <b>Подписки на уведомления:</b>
${subscribedText}

🔔 <b>Типы уведомлений:</b>
${sub?.notifyNewEmployee !== false ? '✅' : '❌'} Новые сотрудники
${sub?.notifyDeleteEmployee !== false ? '✅' : '❌'} Удаление сотрудников
${sub?.active !== false ? '✅' : '❌'} Уведомления активны`, keyboard);
        return;
    }
    
    // Переключение подписок
    if (data.startsWith('toggle_')) {
        const sub = await TelegramSubscription.findOne({ chatId: chatId.toString() });
        
        if (!sub) {
            await sendTelegramTo(chatId, '⚠️ Напишите /start для начала работы');
            return;
        }
        
        if (data === 'toggle_all') {
            if (sub.subscribedTo.includes('all')) {
                sub.subscribedTo = [];
            } else {
                sub.subscribedTo = ['all'];
            }
            await sub.save();
            
        } else {
            const empId = data.replace('toggle_', '');
            
            if (sub.subscribedTo.includes('all')) {
                const allEmployees = await Employee.find();
                sub.subscribedTo = allEmployees.map(e => e._id.toString());
            }
            
            const index = sub.subscribedTo.indexOf(empId);
            if (index > -1) {
                sub.subscribedTo.splice(index, 1);
            } else {
                sub.subscribedTo.push(empId);
            }
            
            const allEmployees = await Employee.find();
            if (sub.subscribedTo.length === allEmployees.length) {
                sub.subscribedTo = ['all'];
            }
            
            await sub.save();
        }
        
        // Обновляем список
        const employees = await Employee.find().sort({ name: 1 });
        const updatedSub = await TelegramSubscription.findOne({ chatId: chatId.toString() });
        
        let message = '🔔 <b>Настройка уведомлений</b>\n\n';
        message += 'Выберите, от кого получать уведомления:\n';
        
        const keyboard = {
            inline_keyboard: []
        };
        
        const isAllSubscribed = updatedSub && updatedSub.subscribedTo.includes('all');
        keyboard.inline_keyboard.push([{
            text: `${isAllSubscribed ? '✅' : '⬜'} Все сотрудники`,
            callback_data: `toggle_all`
        }]);
        
        for (const emp of employees) {
            const isSubscribed = updatedSub && (
                updatedSub.subscribedTo.includes('all') || 
                updatedSub.subscribedTo.includes(emp._id.toString())
            );
            
            keyboard.inline_keyboard.push([{
                text: `${isSubscribed ? '✅' : '⬜'} ${emp.name}`,
                callback_data: `toggle_${emp._id.toString()}`
            }]);
        }
        
        keyboard.inline_keyboard.push([{
            text: '🔙 Меню',
            callback_data: 'main_menu'
        }]);
        
        await editTelegramMessage(chatId, messageId, message, keyboard);
        return;
    }
}

// ==================== TELEGRAM WEBHOOK ====================

// Middleware для webhook (должен быть ДО app.use(express.json()))
app.post('/api/telegram/webhook', express.json(), async (req, res) => {
    try {
        const update = req.body;
        
        if (update.message) {
            const chatId = update.message.chat.id;
            const text = update.message.text || '';
            const from = update.message.from;
            
            await handleBotCommand(chatId, text, from);
        }
        
        if (update.callback_query) {
            const chatId = update.callback_query.message.chat.id;
            const data = update.callback_query.data;
            const messageId = update.callback_query.message.message_id;
            const from = update.callback_query.from;
            
            await handleCallback(chatId, data, messageId, from);
            
            const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    callback_query_id: update.callback_query.id
                })
            });
        }
        
        res.json({ ok: true });
    } catch (err) {
        console.error('Webhook error:', err);
        res.json({ ok: true });
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Инициализация админа
async function initAdmin() {
    try {
        let settings = await Settings.findOne({ key: 'main' });
        if (!settings) {
            settings = new Settings({
                key: 'main',
                adminUsername: 'admin',
                adminPassword: bcrypt.hashSync('admin123', 10),
                adminName: 'Администратор'
            });
            await settings.save();
            console.log('✅ Админ создан: admin / admin123');
        }
    } catch (err) {
        console.error('Ошибка инициализации:', err);
    }
}

// Авторизация middleware
function auth(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен' });
        req.user = user;
        next();
    });
}

// ==================== AUTH ====================

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const settings = await Settings.findOne({ key: 'main' });
        
        if (!settings || username !== settings.adminUsername || 
            !bcrypt.compareSync(password, settings.adminPassword)) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }
        
        const token = jwt.sign(
            { username, name: settings.adminName, role: 'admin' },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({ 
            token, 
            user: { username, name: settings.adminName, role: 'admin' } 
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/auth/verify', auth, (req, res) => {
    res.json({ user: req.user });
});

// ==================== EMPLOYEES ====================

app.get('/api/employees', auth, async (req, res) => {
    try {
        const employees = await Employee.find().sort({ createdAt: 1 });
        res.json(employees.map(e => ({
            id: e._id.toString(),
            name: e.name,
            color: e.color
        })));
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/employees', auth, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Введите имя' });
        
        const count = await Employee.countDocuments();
        const colors = ['#ff6b6b','#4ecdc4','#45b7d1','#96ceb4','#ffeaa7','#fd79a8','#a29bfe','#6c5ce7'];
        
        const employee = new Employee({
            name,
            color: colors[count % colors.length]
        });
        
        await employee.save();
        
        await notifyNewEmployee(name);
        
        res.json({
            id: employee._id.toString(),
            name: employee.name,
            color: employee.color
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.delete('/api/employees/:id', auth, async (req, res) => {
    try {
        const employee = await Employee.findById(req.params.id);
        const employeeName = employee ? employee.name : 'Неизвестный';
        
        await Employee.findByIdAndDelete(req.params.id);
        await Shift.deleteMany({ key: { $regex: `^${req.params.id}_` } });
        
        await TelegramSubscription.updateMany(
            {},
            { $pull: { subscribedTo: req.params.id } }
        );
        
        await notifyDeleteEmployee(employeeName);
        
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ==================== SHIFTS ====================

app.get('/api/shifts', auth, async (req, res) => {
    try {
        const shifts = await Shift.find();
        const result = {};
        shifts.forEach(s => {
            result[s.key] = {
                type: s.type,
                hours: s.hours,
                cleaning: s.cleaning
            };
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/shifts', auth, async (req, res) => {
    try {
        const { key, data } = req.body;
        
        const [empId, dateKey] = key.split('_');
        const employee = await Employee.findById(empId);
        const employeeName = employee ? employee.name : 'Неизвестный';
        
        const [year, month, day] = dateKey.split('-');
        const formattedDate = `${day} ${MONTH_NAMES_SHORT[parseInt(month)]} ${year}`;
        
        const existingShift = await Shift.findOne({ key });
        let action = 'updated';
        if (!existingShift && data) action = 'created';
        else if (data === null) action = 'deleted';
        
        if (data === null) {
            await Shift.findOneAndDelete({ key });
        } else {
            await Shift.findOneAndUpdate(
                { key },
                { key, type: data.type, hours: data.hours, cleaning: data.cleaning },
                { upsert: true, new: true }
            );
        }
        
        await notifyShiftChange(empId, employeeName, formattedDate, data, action);
        
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ==================== SETTINGS ====================

app.get('/api/settings', auth, async (req, res) => {
    res.json({ defaultHours: 10 });
});

app.post('/api/settings', auth, async (req, res) => {
    res.json({ defaultHours: 10 });
});

// Запуск
initAdmin().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Сервер запущен на порту ${PORT}`);
    });
});
