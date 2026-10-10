const express = require('express'); 
const axios = require('axios'); 
const fs = require('fs/promises');
const path = require('path');
 
const app = express(); 
app.use(express.json()); 
app.use(express.static(path.join(__dirname, 'public')));
 
const PORT = Number(process.env.PORT || 3001); 
const PYTHON_URL = process.env.PYTHON_URL || 'http://127.0.0.1:5101';
const HISTORY_PATH = path.join(__dirname, 'history.csv');
let historyWrite = Promise.resolve();

function csvValue(value) {
    const text = value == null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

function appendHistory(data, result) {
    const row = [
        new Date().toISOString(),
        data.num1,
        data.num2,
        data.operation,
        result
    ].map(csvValue).join(',') + '\n';

    const write = historyWrite.then(async () => {
        let needsHeader = false;
        try {
            await fs.access(HISTORY_PATH);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            needsHeader = true;
        }

        await fs.appendFile(
            HISTORY_PATH,
            (needsHeader ? 'timestamp,num1,num2,operation,result\n' : '') + row,
            'utf8'
        );
    });

    historyWrite = write.catch(() => {});
    return write;
}

function parseCsv(contents) {
    const records = [];
    let record = [];
    let field = '';
    let inQuotes = false;

    for (let index = 0; index < contents.length; index += 1) {
        const character = contents[index];
        if (inQuotes) {
            if (character === '"' && contents[index + 1] === '"') {
                field += '"';
                index += 1;
            } else if (character === '"') {
                inQuotes = false;
            } else {
                field += character;
            }
        } else if (character === '"' && field.length === 0) {
            inQuotes = true;
        } else if (character === ',') {
            record.push(field);
            field = '';
        } else if (character === '\n') {
            record.push(field);
            records.push(record);
            record = [];
            field = '';
        } else if (character !== '\r') {
            field += character;
        }
    }

    if (field.length > 0 || record.length > 0) {
        record.push(field);
        records.push(record);
    }

    const [headers, ...rows] = records;
    if (!headers) return [];

    return rows
        .filter((row) => row.length === headers.length)
        .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])))
        .reverse();
}
 
// Route 1: Simple test endpoint 
app.get('/hello', (req, res) => { 
    res.json({ message: 'Hello from Node.js Gateway!' }); 
}); 
 
// Route 2: Main integration endpoint 
app.post('/api/calculate', async (req, res) => {
    const data = req.body ?? {};

    console.log('Node.js received:', data);
    
    let pythonResponse;

    try {
        pythonResponse = await axios.post(`${PYTHON_URL}/calculate`, data);
    } catch (error) {
        console.error(' Error:', error.message);
        try {
            await appendHistory(data, error.response?.data?.result ?? `Error: ${error.message}`);
        } catch (historyError) {
            console.error('Failed to write calculation history:', historyError.message);
        }

        return res.status(502).json({
            error: 'Failed to reach Python service. Is it running on port 5001?'
        });
    }

    try {
        await appendHistory(data, pythonResponse.data.result);
    } catch (error) {
        console.error('Failed to write calculation history:', error.message);
        return res.status(500).json({ error: 'Failed to record calculation history' });
    }

    res.json({
        gateway_message: 'Node.js successfully aggregated the data!',
        python_result: pythonResponse.data
    });
}); 

app.get('/api/history', async (req, res) => {
    try {
        const contents = await fs.readFile(HISTORY_PATH, 'utf8');
        res.json(parseCsv(contents));
    } catch (error) {
        if (error.code === 'ENOENT') return res.json([]);
        console.error('Failed to read calculation history:', error.message);
        res.status(500).json({ error: 'Failed to read calculation history' });
    }
});
 
// Route 3: System status check 
app.get('/api/status', async (req, res) => {     try { 
        const ping = await axios.get(`${PYTHON_URL}/ping`);         res.json({ 
            gateway: 'Node.js is running',             python: ping.data 
        }); 
    }   catch (error) {         res.status(500).json({             gateway: 'Node.js is running', 
            python: 'Python is NOT reachable' 
        }); 
    } 
}); 
 
app.listen(PORT, () => { 
    console.log(`Node.js Gateway: http://localhost:${PORT}`);     console.log(`Python URL: ${PYTHON_URL}`); 
}); 
