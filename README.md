# HR Nexus — Complete HR Management System

A professional, full-featured HR management web application built with HTML, CSS, and Vanilla JavaScript.  
Data is stored in **Google Sheets**, connected via **Google Apps Script** as a REST API.  
Designed for **GitHub Pages** hosting (fully static).

---

## 📁 Project Structure

```
hr-management/
├── index.html             ← Login page (employee + admin)
├── profile.html           ← Employee profile
├── attendance.html        ← Check-in / Check-out
├── announcements.html     ← Company announcements
├── salary.html            ← Salary, bonuses & deductions view
├── admin.html             ← Admin dashboard (full CRUD)
├── apps-script.js         ← Google Apps Script backend (copy to GAS editor)
├── assets/
│   ├── style.css          ← Full responsive stylesheet
│   ├── script.js          ← Shared utilities, API layer, session management
│   └── admin.js           ← Admin-specific CRUD logic
└── README.md
```

---

## 🚀 Step 1 — Set Up Google Sheets

1. Go to [sheets.google.com](https://sheets.google.com) and create a **new spreadsheet**
2. Name it something like **"HR Nexus Database"**
3. Open **Extensions → Apps Script**
4. Delete any existing code and **paste the entire contents of `apps-script.js`**
5. Save the script (Ctrl+S)
6. In the Apps Script editor, click the **function dropdown** at the top and select `setupSpreadsheet`
7. Click **Run** — this will create all required sheets and add sample accounts
8. Authorize the script when prompted (it needs access to your spreadsheet)

### Google Sheets tabs created automatically:
| Sheet | Columns |
|-------|---------|
| Employees | ID, Name, Department, Position, Phone, Email, HireDate, Password, Role |
| Attendance | RowID, EmployeeID, Name, Date, CheckIn, CheckOut |
| Announcements | ID, Title, Message, Date |
| Salary | ID, EmployeeID, Name, Bonus, Deduction, Notes, Date |
| Requests | ID, EmployeeID, Name, Type, Message, Status, Date |

---

## 🔌 Step 2 — Deploy Google Apps Script as Web App

1. In the Apps Script editor, click **Deploy → New deployment**
2. Click the gear icon ⚙️ next to "Select type" → choose **Web app**
3. Set:
   - **Description**: HR Nexus API
   - **Execute as**: Me (your Google account)
   - **Who has access**: **Anyone**
4. Click **Deploy**
5. **Copy the Web App URL** (looks like: `https://script.google.com/macros/s/XXXXXXXX/exec`)

> ⚠️ **Important**: Every time you edit the Apps Script code, you must create a **New Deployment** to get the changes to take effect.

---

## ⚙️ Step 3 — Connect Frontend to API

Open `assets/script.js` and find this section at the top:

```javascript
const CONFIG = {
  API_URL: 'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE',
  ...
};
```

Replace `'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE'` with your actual Apps Script URL:

```javascript
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/YOUR_ACTUAL_ID/exec',
  ...
};
```

---

## 🌐 Step 4 — Deploy to GitHub Pages

1. Create a new repository on [GitHub](https://github.com) (e.g., `hr-nexus`)
2. Upload all project files to the repository root
3. Go to **Settings → Pages**
4. Under "Source", select **Deploy from a branch → main → / (root)**
5. Click **Save**
6. Your app will be live at: `https://YOUR_USERNAME.github.io/hr-nexus/`

---

## 🔑 Default Login Credentials

These are created by the `setupSpreadsheet()` function:

| Role | ID | Password |
|------|----|----------|
| Admin | `ADMIN001` | `admin123` |
| Employee | `EMP001` | `emp123` |

> ⚠️ **Change these immediately** in production by editing the Employees sheet.

---

## ✨ Features

### Employee Portal
- 🔐 Secure login with role-based access
- 👤 Profile page with all personal/work details
- 🕐 Real-time clock with Check-In / Check-Out
- 📢 Company announcements feed
- 💰 Salary, bonus & deduction history

### Admin Dashboard
- 👥 Full employee management (Add / Edit / Delete)
- 📋 Attendance records with employee & date filters
- 💰 Salary & bonus management per employee
- 📢 Announcement publishing (Add / Edit / Delete)
- 📊 Overview statistics dashboard

---

## 🛠️ Customization

### Change App Colors
Edit CSS variables in `assets/style.css`:
```css
:root {
  --gold-500: #f59e0b;    /* primary accent */
  --navy-900: #0f172a;    /* main background */
  --bg-card:  #1a2744;    /* card background */
}
```

### Add More Admin Accounts
In the Employees sheet, add a row with `Role = admin`.

### Timezone
In `apps-script.js`, the script uses `Session.getScriptTimeZone()` automatically.  
To set a specific timezone, replace with a string like `'America/New_York'` or `'Asia/Baghdad'`.

---

## 📞 Support & Notes

- This project uses **no external dependencies** — pure HTML/CSS/JS
- Google Apps Script has a **daily execution quota** — suitable for small to mid-sized companies
- All API calls go through HTTPS (Google's infrastructure)
- Session data is stored in browser `localStorage` — clearing browser data will log users out
