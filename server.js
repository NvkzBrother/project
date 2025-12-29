const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'shift-scheduler-secret-2024';

// MongoDB подключение
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
    key: { type: String, unique: true }, // формат: empId_year-month-day
    type: String, // 'work', 'off', 'vacation', 'sick'
    hours: Number,
    cleaning: String // null, 'cleaning', 'fullCleaning'
});

const Settings = mongoose.model('Settings', SettingsSchema);
const Employee = mongoose.model('Employee', EmployeeSchema);
const Shift = mongoose.model('Shift', ShiftSchema);

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
        await Employee.findByIdAndDelete(req.params.id);
        // Удаляем все смены этого сотрудника
        await Shift.deleteMany({ key: { $regex: `^${req.params.id}_` } });
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
        
        if (data === null) {
            await Shift.findOneAndDelete({ key });
        } else {
            await Shift.findOneAndUpdate(
                { key },
                { key, type: data.type, hours: data.hours, cleaning: data.cleaning },
                { upsert: true, new: true }
            );
        }
        
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
