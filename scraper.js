// পেজ ওপেন বা রিলোড হলেই এই ফাংশনটি রান হবে
window.addEventListener('DOMContentLoaded', async () => {
    // আপনার গিটহাবের সঠিক ইউজারনেম, রেপো এবং টোকেন ভেরিয়েবলগুলো এখানে ব্যবহার করুন
    const OWNER = 'sanjudev264';
    const REPO = 'maps-scraper-panel'; // আপনার রেপোজিটোরির নাম দিন
    const TOKEN = 'YOUR_GITHUB_TOKEN'; // আপনার ব্যবহৃত টোকেনটি এখানে বসবে

    const statusTextContainer = document.querySelector('.status-container'); // আপনার প্যানেলের স্ট্যাটাস বক্সের ক্লাস
    const buttonText = document.querySelector('.process-btn'); // প্রসেস বাটনের ক্লাস

    try {
        // গিটহাবের রানিং ওয়ার্কফ্লো চেক করার API রিকোয়েস্ট
        const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs?status=in_progress`, {
            headers: {
                'Authorization': `token ${TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        const data = await response.json();

        // যদি কোনো ওয়ার্কফ্লো 'in_progress' বা বর্তমানে রানিং থাকে
        if (data.workflow_runs && data.workflow_runs.length > 0) {
            const isScraperRunning = data.workflow_runs.some(run => run.name === 'Google Maps Scraper');
            
            if (isScraperRunning) {
                // 🔄 পেজ রিলোড হলেও রানিং স্ট্যাটাস স্ক্রিনে ফিরিয়ে আনবে
                if(buttonText) buttonText.innerText = "⏳ ফাইল প্রসেস হচ্ছে...";
                if(statusTextContainer) {
                    statusTextContainer.innerHTML = "⚙️ স্ক্র্যাপার বর্তমানে লাইভ কাজ করছে!";
                    statusTextContainer.style.display = "block";
                }
                
                // কাজ শেষ হওয়া পর্যন্ত ব্যাকগ্রাউন্ডে চেক করতে থাকবে (Polling)
                checkWorkflowStatus(data.workflow_runs[0].id, OWNER, REPO, TOKEN);
            }
        }
    } catch (error) {
        console.error("স্ট্যাটাস চেক করতে সমস্যা হয়েছে:", error);
    }
});

// ব্যাকগ্রাউন্ডে প্রতি ১০-১৫ সেকেন্ড পর পর চেক করার ফাংশন (কাজ শেষ হলে ডাউনলোড বাটন দেখানোর জন্য)
function checkWorkflowStatus(runId, owner, repo, token) {
    const interval = setInterval(async () => {
        try {
            const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`, {
                headers: { 'Authorization': `token ${token}` }
            });
            const runData = await res.json();
            
            if (runData.status === 'completed') {
                clearInterval(interval);
                // কাজ শেষ হলে এখানে ডাউনলোড বাটন বা সাকসেস মেসেজ দেখানোর কোড লিখুন
                document.querySelector('.process-btn').innerText = "✅ ডাউনলোড করুন";
                document.querySelector('.status-container').innerHTML = "🎉 স্ক্র্যাপিং সফলভাবে শেষ হয়েছে!";
            }
        } catch (e) {
            clearInterval(interval);
        }
    }, 15000); // প্রতি ১৫ সেকেন্ড পর পর চেক করবে
}
