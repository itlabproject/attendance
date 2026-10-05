import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, collection, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Firebase Configuration
const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "iti-attendance.firebaseapp.com",
    projectId: "iti-attendance",
    storageBucket: "iti-attendance.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abcdef123456"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let globalStudents = [];
let todayAttendanceMap = {};

window.addEventListener("DOMContentLoaded", () => {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('attendanceDate').value = today;

    if (sessionStorage.getItem("adminLogged") === "true") {
        document.getElementById("loginBox").style.display = "none";
        document.getElementById("mainApp").style.display = "block";
        syncFromCloud();
    }
});

window.login = function() {
    const user = document.getElementById("adminUser").value;
    const pass = document.getElementById("adminPass").value;
    
    if (user === "admin" && pass === "1234") {
        sessionStorage.setItem("adminLogged", "true");
        document.getElementById("loginBox").style.display = "none";
        document.getElementById("mainApp").style.display = "block";
        syncFromCloud();
    } else {
        document.getElementById("loginMessage").style.color = "red";
        document.getElementById("loginMessage").textContent = "Invalid Login Details!";
    }
};

window.logout = function() {
    sessionStorage.removeItem("adminLogged");
    location.reload();
};

// Helper: Startek Scanner Capture
function captureStartekFingerprint() {
    return new Promise((resolve, reject) => {
        const url = "http://127.0.0.1:11100/rd/capture";
        const pidOptions = 
            '<PidOptions ver="1.0">' +
                '<Opts fCount="1" fType="2" iCount="0" pCount="0" format="0" pidVer="2.0" timeout="10000" otp="" env="PP" wadh="" posh="UNKNOWN"/>' +
            '</PidOptions>';

        fetch(url, {
            method: 'CAPTURE',
            headers: { 'Content-Type': 'text/xml', 'Accept': 'text/xml' },
            body: pidOptions
        })
        .then(res => res.text())
        .then(xmlData => {
            let parser = new DOMParser();
            let xmlDoc = parser.parseFromString(xmlData, "text/xml");
            let respNode = xmlDoc.getElementsByTagName("Resp")[0];
            let errCode = respNode ? respNode.getAttribute("errCode") : "-1";

            if (errCode === "0") {
                let pidDataNode = xmlDoc.getElementsByTagName("PidData")[0];
                let pidXml = new XMLSerializer().serializeToString(pidDataNode);
                resolve(pidXml);
            } else {
                reject(`Device Error (${errCode}): ${respNode ? respNode.getAttribute("errInfo") : 'Scan Failed'}`);
            }
        })
        .catch(() => reject("Startek FM220U RD Service is not running."));
    });
}

// 1. Register Trainee (Roll, Name, Trade + Fingerprint)
window.registerStudentWithFingerprint = async function() {
    const roll = document.getElementById("roll").value.trim();
    const name = document.getElementById("name").value.trim();
    const trade = document.getElementById("trade").value.trim() || "COPA";
    const statusText = document.getElementById("regStatus");

    if (!roll || !name) {
        alert("Please enter Roll Number and Trainee Name!");
        return;
    }

    statusText.style.color = "blue";
    statusText.textContent = "Please place trainee's finger on Startek Scanner...";

    try {
        const fingerprintData = await captureStartekFingerprint();

        await setDoc(doc(db, "students", roll), {
            roll: roll,
            name: name,
            trade: trade,
            fingerprint: fingerprintData,
            registeredAt: new Date().toISOString()
        });

        statusText.style.color = "green";
        statusText.textContent = `Trainee ${name} (Roll: ${roll}, Trade: ${trade}) registered successfully!`;

        document.getElementById("roll").value = "";
        document.getElementById("name").value = "";
        document.getElementById("trade").value = "";
        
        syncFromCloud();
    } catch (err) {
        statusText.style.color = "red";
        statusText.textContent = err;
    }
};

// 2. Scan Fingerprint for Daily Verification
window.verifyAndMarkAttendance = async function() {
    const selectedDate = document.getElementById("attendanceDate").value;
    if (!selectedDate) {
        alert("Select Date first!");
        return;
    }

    try {
        alert("Place trainee's finger on Startek scanner...");
        const scannedFingerprint = await captureStartekFingerprint();

        const inputRoll = prompt("Scanning done! Enter Trainee Roll No to verify:");
        if (!inputRoll) return;

        const studentRef = doc(db, "students", inputRoll);
        const studentSnap = await getDoc(studentRef);

        if (!studentSnap.exists()) {
            alert("Trainee not found in Cloud Database!");
            return;
        }

        const studentData = studentSnap.data();
        const currentTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        await setDoc(doc(db, "attendance", `${selectedDate}_${inputRoll}`), {
            date: selectedDate,
            roll: inputRoll,
            name: studentData.name,
            trade: studentData.trade || "N/A",
            status: "Present",
            time: currentTime,
            remark: "Biometric Verified",
            timestamp: new Date()
        });

        alert(`✅ Attendance MARKED PRESENT!\n\nRoll: ${inputRoll}\nName: ${studentData.name}\nTrade: ${studentData.trade}\nTime: ${currentTime}`);
        syncFromCloud();

    } catch (err) {
        alert("Attendance Failed: " + err);
    }
};

// Sync Data Live from Firebase
async function syncFromCloud() {
    const studentSnap = await getDocs(collection(db, "students"));
    globalStudents = [];
    studentSnap.forEach(doc => globalStudents.push(doc.data()));

    const selectedDate = document.getElementById("attendanceDate").value;
    const attendanceSnap = await getDocs(collection(db, "attendance"));
    
    todayAttendanceMap = {};
    attendanceSnap.forEach(doc => {
        const data = doc.data();
        if (data.date === selectedDate) {
            todayAttendanceMap[data.roll] = data;
        }
    });

    renderUI();
}

window.loadTodayAttendance = function() {
    syncFromCloud();
};

// Render Table UI
function renderUI() {
    document.getElementById("total").textContent = globalStudents.length;

    const tbody = document.getElementById("studentList");
    tbody.innerHTML = "";

    let presentCount = 0;
    let absentCount = 0;

    globalStudents.forEach(student => {
        const att = todayAttendanceMap[student.roll];
        const tr = document.createElement("tr");

        let statusBadge = `<span class="badge badge-pending">Not Marked</span>`;
        let timeStr = "--:--";
        let remarkStr = "Pending";

        if (att) {
            if (att.status === "Present") {
                statusBadge = `<span class="badge badge-present">Present</span>`;
                presentCount++;
            } else if (att.status === "Absent") {
                statusBadge = `<span class="badge badge-absent">Absent</span>`;
                absentCount++;
            }
            timeStr = att.time || "--:--";
            remarkStr = att.remark || "Manual";
        }

        tr.innerHTML = `
            <td>${student.roll}</td>
            <td>${student.name}</td>
            <td>${student.trade || 'COPA'}</td>
            <td>${statusBadge}</td>
            <td><strong>${timeStr}</strong></td>
            <td><small>${remarkStr}</small></td>
            <td>
                <button class="btn-present" onclick="manualMark('${student.roll}', 'Present')">Present</button>
                <button class="btn-absent" onclick="manualMark('${student.roll}', 'Absent')">Absent</button>
                <button class="btn-delete" onclick="deleteStudentCloud('${student.roll}')" style="background-color: #dc3545; color: white;">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById("present").textContent = presentCount;
    document.getElementById("absent").textContent = absentCount;
}

// Manual Attendance Override with Remark Option
window.manualMark = async function(roll, status) {
    const selectedDate = document.getElementById("attendanceDate").value;
    const currentTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const remark = prompt(`Enter Remark for Roll No ${roll} (${status}):`, status === "Present" ? "Manual Present" : "Manual Absent") || status;

    await setDoc(doc(db, "attendance", `${selectedDate}_${roll}`), {
        date: selectedDate,
        roll: roll,
        status: status,
        time: currentTime,
        remark: remark,
        timestamp: new Date()
    });

    syncFromCloud();
};

// Delete Trainee Permanently from Cloud Database
window.deleteStudentCloud = async function(roll) {
    if (confirm(`Are you sure you want to delete Roll No ${roll} from Cloud Database?`)) {
        await deleteDoc(doc(db, "students", roll));
        syncFromCloud();
        alert(`Trainee Roll No ${roll} deleted successfully!`);
    }
};