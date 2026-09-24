document.addEventListener('DOMContentLoaded', () => {
    const employeeForm = document.getElementById('employeeForm');
    const employeesTableBody = document.getElementById('employeesTableBody');

    async function loadEmployees() {
        try {
            const res = await fetch('/api/employees');
            const employees = await res.json();
            
            employeesTableBody.innerHTML = '';
            employees.forEach(emp => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${emp.id}</td>
                    <td>${emp.name}</td>
                    <td>${emp.position}</td>
                    <td><span class="status-tag">${emp.total_orders} активый(х)</span></td>
                `;
                employeesTableBody.appendChild(row);
            });
        } catch (e) { console.error(e); }
    }

    employeeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newEmp = {
            name: document.getElementById('empName').value,
            position: document.getElementById('empPosition').value
        };

        const res = await fetch('/api/employees', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newEmp)
        });

        if (res.ok) {
            employeeForm.reset();
            loadEmployees();
        }
    });

    loadEmployees();
});