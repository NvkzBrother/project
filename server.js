const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'shift-scheduler-secret-key-2024';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const DB_PATH = path.join(__dirname, 'data', 'database.json');

function initDatabase() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
        const initialData = {
            users: [{
                id: '1',
                username: 'admin',
                password: bcrypt.hashSync('admin123', 10),
                role: 'admin',
                name: 'Администратор'
            }],
            employees: [],
            shifts: {},
            settings: { defaultHours: 10 }
        };
        saveDatabase(initialData);
        console.log('База данных создана. Логин: admin, Пароль: admin123');
    }
}

function readDatabase() {
    try {
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (e) {
        return null;
    }
}

function saveDatabase(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        return false;
    }
}

function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен' });
        req.user = user;
        next();
    });
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Требуются права администратора' });
    }
    next();
}

// Auth
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Введите логин и пароль' });
    }
    
    const db = readDatabase();
    const user = db.users.find(u => u.username === username);
    
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    
    const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role, name: user.name },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
    
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, name: user.name } });
});

app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ user: req.user });
});

// Users
app.get('/api/users', authenticateToken, requireAdmin, (req, res) => {
    const db = readDatabase();
    res.json(db.users.map(u => ({ id: u.id, username: u.username, role: u.role, name: u.name })));
});

app.post('/api/users', authenticateToken, requireAdmin, (req, res) => {
    const { username, password, role, name } = req.body;
    if (!username || !password || !name) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    const db = readDatabase();
    if (db.users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    
    const newUser = {
        id: Date.now().toString(),
        username,
        password: bcrypt.hashSync(password, 10),
        role: role || 'viewer',
        name
    };
    
    db.users.push(newUser);
    saveDatabase(db);
    res.json({ id: newUser.id, username: newUser.username, role: newUser.role, name: newUser.name });
});

app.delete('/api/users/:id', authenticateToken, requireAdmin, (req, res) => {
    if (req.params.id === req.user.id) {
        return res.status(400).json({ error: 'Нельзя удалить себя' });
    }
    
    const db = readDatabase();
    db.users = db.users.filter(u => u.id !== req.params.id);
    saveDatabase(db);
    res.json({ message: 'Удалено' });
});

// Employees
app.get('/api/employees', authenticateToken, (req, res) => {
    res.json(readDatabase().employees || []);
});

app.post('/api/employees', authenticateToken, requireAdmin, (req, res) => {
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Введите имя' });
    
    const db = readDatabase();
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#fd79a8', '#a29bfe'];
    const newEmp = {
        id: Date.now().toString(),
        name,
        color: color || colors[db.employees.length % colors.length]
    };
    
    db.employees.push(newEmp);
    saveDatabase(db);
    res.json(newEmp);
});

app.delete('/api/employees/:id', authenticateToken, requireAdmin, (req, res) => {
    const db = readDatabase();
    db.employees = db.employees.filter(e => e.id !== req.params.id);
    Object.keys(db.shifts).forEach(k => {
        if (k.startsWith(req.params.id + '_')) delete db.shifts[k];
    });
    saveDatabase(db);
    res.json({ message: 'Удалено' });
});

// Shifts
app.get('/api/shifts', authenticateToken, (req, res) => {
    res.json(readDatabase().shifts || {});
});

app.post('/api/shifts', authenticateToken, requireAdmin, (req, res) => {
    const { key, data } = req.body;
    const db = readDatabase();
    if (data === null) delete db.shifts[key];
    else db.shifts[key] = data;
    saveDatabase(db);
    res.json({ success: true });
});

// Settings
app.get('/api/settings', authenticateToken, (req, res) => {
    res.json(readDatabase().settings || { defaultHours: 10 });
});

app.post('/api/settings', authenticateToken, requireAdmin, (req, res) => {
    const db = readDatabase();
    db.settings = { ...db.settings, ...req.body };
    saveDatabase(db);
    res.json(db.settings);
});

initDatabase();

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
