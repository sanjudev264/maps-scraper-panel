# 📍 Google Maps Lead Scraper Panel

A powerful, fully cloud-based **Google Maps Lead Scraper** with a user-friendly web interface. Scrape targeted B2B leads (Business Name, Phone, Website, Address, and Maps Link) directly via GitHub Actions—without burning your own PC's RAM or CPU!

---

## ✨ Features

*   **☁️ 100% Cloud-Based:** The actual scraping process (Puppeteer/Browser automation) runs on GitHub's cloud servers, meaning **zero lag** on your local computer.
*   **🔗 Direct Map Links:** No need to manually create CSV files. Just copy and paste one or multiple Google Maps search URLs directly into the text box.
*   **🎯 Smart Filtering:** Keep only specific business categories and automatically exclude unwanted major franchise domains (e.g., `servpro.com`, `pauldavis.com`).
*   **🔄 Auto-De-duplication:** Automatically filters out duplicate business listings or phone numbers before exporting.
*   **⏳ Live Status Tracking:** Watch the progress live on the web panel without ever needing to log into GitHub.
*   **📥 One-Click Direct Download:** Once the scraping is finished, a download button appears directly on your web panel.

---

## 🛠️ Setup Guide (For New Users)

To deploy your own instance of this panel, follow these quick steps:

### 0. Fork and Enable Actions
Before starting, you **MUST** fork this repository to your own GitHub account:
*   Click the **"Fork"** button at the top right of this page to create a copy under your account.
*   After forking, go to the **Actions** tab of your new repository and click the green button that says **"I understand my workflows, go ahead and enable them"**. *(Crucial step!)*

### 1. Generate a GitHub Personal Access Token
*   Go to your GitHub Account **Settings > Developer Settings > Personal Access Tokens > Tokens (classic)**.
*   Click **Generate new token (classic)**.
*   Give it a note (e.g., `Maps-Scraper`).
*   Select the following scopes: **`repo`** and **`workflow`**.
*   Click generate, and copy the token safely. *(Treat it like a password!)*

### 2. Enable GitHub Pages
*   Go to your repository's **Settings > Pages** tab.
*   Under **Build and deployment**, set the Source to `Deploy from a branch`.
*   Choose your branch as **`main`** and the folder as `/ (root)`, then click **Save**.
*   Within 1–2 minutes, GitHub will give you a live URL (e.g., `https://yourusername.github.io/your-repo-name/`).

---

## 🚀 How to Use

1.  Open your **GitHub Pages Live URL**.
2.  Paste your **GitHub Personal Access Token** into the token field.
3.  Enter your **Repository path** (Format: `your-github-username/your-repo-name`).
4.  **Step 1:** Paste your Google Maps search links (one per line) into the box. *(Alternatively, you can still upload a traditional `input.csv` file).*
5.  **Step 2 & 3:** Enter the categories you want to include and domains you want to exclude (one per line).
6.  Click the **"🚀 Run Scraper"** button.
7.  Keep the tab open. The panel will track the cloud progress live. Once completed, a green **"📥 Download File"** button will dynamically appear. Click it to download your fresh leads!

---

## 🔒 Security & Privacy

*   **Client-Side Security:** Your GitHub Personal Access Token is saved **only** in your local browser storage (`LocalStorage`). It is never sent to any third-party server or database.
*   **Private Repo Friendly:** You can keep this repository completely **Private** to protect your code and scraped data; the GitHub Pages panel will still work perfectly for you.

---
💡 *Maintained by [Sanjudev](https://github.com/sanjudev246)*
