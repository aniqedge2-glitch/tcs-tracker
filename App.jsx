import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://knbcaftmrijmehwzqquj.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtuYmNhZnRtcmlqbWVod3pxcXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEwOTg1NzUsImV4cCI6MjA4NjY3NDU3NX0.IJQyJqGeVqRiyXE0p8bzPulOCpQD-q9UAeX7O4ecDBE';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

function App() {
  // 🔥 TOP LEVEL NAVIGATION STATES
  const [screen, setScreen] = useState('home');
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedMealType, setSelectedMealType] = useState('');

  // 🔥 CREATE CUSTOMER FORM STATES
  const [customerForm, setCustomerForm] = useState({
    name: '',
    id: '',
    phone: '',
    address: '',
    googleMapLink: ''
  });

  // 🔥 CALENDAR STATES
  const [currentMonth, setCurrentMonth] = useState(new Date('2026-02-15'));
  const [customerPlans, setCustomerPlans] = useState([]);
  const [mealCancelledDates, setMealCancelledDates] = useState([]);
  const [planDays, setPlanDays] = useState(5);
  const [startDate, setStartDate] = useState('');
  const [newMarkedDays, setNewMarkedDays] = useState([]);
  const [originalPlanLength, setOriginalPlanLength] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  // 🔥 NEW: Manual input fields
  const [manualPlanDays, setManualPlanDays] = useState('5');
  const [manualStartDate, setManualStartDate] = useState('');
  const [manualCancelDates, setManualCancelDates] = useState('');
  const [manualExtendedDates, setManualExtendedDates] = useState('');
  
  const lastExtendedPlanRef = useRef([]);

  // 🔥 Load customers on mount
  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, phone, address, google_map_link')
        .order('id', { ascending: false });

      if (error) throw error;
      setCustomers(data || []);
      setMessage(data?.length ? `✅ ${data.length} customers loaded` : '👤 No customers - create one!');
    } catch (error) {
      setMessage(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // 🔥 CREATE CUSTOMER FUNCTIONS
  const handleCustomerFormChange = (field, value) => {
    setCustomerForm(prev => ({ ...prev, [field]: value }));
  };

  const createNewCustomer = async () => {
    if (!customerForm.name.trim()) {
      setMessage('❌ Customer name is required!');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('customers')
        .insert([{
          name: customerForm.name.trim(),
          phone: customerForm.phone.trim() || null,
          address: customerForm.address.trim() || null,
          google_map_link: customerForm.googleMapLink.trim() || null
        }])
        .select();

      if (error) throw error;
      
      const newCustomer = data[0];
      setCustomers(prev => [newCustomer, ...prev]);
      setCustomerForm({ name: '', id: '', phone: '', address: '', googleMapLink: '' });
      setMessage(`✅ Created: "${newCustomer.name}" (ID: ${newCustomer.id})`);
      setScreen('home');
    } catch (error) {
      setMessage(`❌ Failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 🔥 MEAL TYPE SELECTION FUNCTIONS
  const selectCustomerForMeals = (customer) => {
    setSelectedCustomer(customer);
    setScreen('customerMeals');
  };

  const selectMealType = async (mealType) => {
    setSelectedMealType(mealType);
    setLoading(true);
    
    try {
      // Load existing plans for this meal type
      const { data: plans, error: plansError } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('customer_id', selectedCustomer.id)
        .eq(`meals->>${mealType}`, 'true')
        .order('date');
      
      if (plansError) throw plansError;
      
      // Load cancellations for this meal type
      const { data: cancels, error: cancelsError } = await supabase
        .from('meal_cancellations')
        .select('date')
        .eq('customer_id', selectedCustomer.id)
        .eq('meal_type', mealType);
      
      if (cancelsError) throw cancelsError;
      
      setCustomerPlans(plans || []);
      const cancelDates = cancels?.map(c => c.date.split('T')[0]) || [];
      setMealCancelledDates(cancelDates);
      setNewMarkedDays([]);
      
      // Extract original plan length from metadata
      let origLength = 0;
      if (plans && plans.length > 0) {
        try {
          const firstPlan = plans.find(p => p.metadata);
          if (firstPlan && firstPlan.metadata) {
            const metadata = typeof firstPlan.metadata === 'string' 
              ? JSON.parse(firstPlan.metadata) 
              : firstPlan.metadata;
            if (metadata?.original_plan_length) {
              origLength = metadata.original_plan_length;
            } else {
              origLength = plans.length;
            }
          } else {
            origLength = plans.length;
          }
        } catch (err) {
          console.error('Failed to parse metadata:', err);
          origLength = plans.length;
        }
      }
      setOriginalPlanLength(origLength);

      // 🔥 NEW: Populate manual input fields
      if (plans && plans.length > 0) {
        const planDates = plans.map(p => p.date.split('T')[0]).sort();
        const firstDate = planDates[0];
        
        setManualPlanDays(origLength.toString());
        setManualStartDate(formatDateDDMMYYYY(firstDate));
        setManualCancelDates(cancelDates.map(formatDateDDMMYYYY).join(', '));
        
        // Calculate extended dates (dates beyond original N)
        const corePlan = getNextWeekdays(firstDate, origLength);
        const extendedDates = planDates.filter(d => !corePlan.includes(d));
        setManualExtendedDates(extendedDates.map(formatDateDDMMYYYY).join(', '));
      } else {
        // Reset fields for new plan
        setManualPlanDays('5');
        setManualStartDate('');
        setManualCancelDates('');
        setManualExtendedDates('');
      }
      
      setHasUnsavedChanges(false);
      lastExtendedPlanRef.current = [];
      setScreen('calendar');
      setMessage(`✅ Loaded ${plans?.length || 0} ${mealType} plans`);
    } catch (error) {
      setMessage(`❌ Failed to load ${mealType} data: ${error.message}`);
      console.error('Load error:', error);
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (screen === 'calendar') {
      setScreen('customerMeals');
      setSelectedMealType('');
      setNewMarkedDays([]);
      setMealCancelledDates([]);
      setOriginalPlanLength(0);
      setHasUnsavedChanges(false);
      lastExtendedPlanRef.current = [];
      setCustomerPlans([]);
      // Reset manual inputs
      setManualPlanDays('5');
      setManualStartDate('');
      setManualCancelDates('');
      setManualExtendedDates('');
    } else if (screen === 'customerMeals') {
      setScreen('home');
      setSelectedCustomer(null);
    } else {
      setScreen('home');
    }
  };

  // 🔥 UTILITY FUNCTIONS
  const isWeekday = (dateStr) => {
    const date = new Date(dateStr + 'T12:00:00');
    const dayOfWeek = date.getDay();
    return dayOfWeek >= 1 && dayOfWeek <= 5;
  };

  const getNextWeekdays = (startDateStr, count) => {
    const weekdays = [];
    let current = new Date(startDateStr + 'T12:00:00');
    
    while (weekdays.length < count) {
      const dateStr = current.toISOString().split('T')[0];
      if (isWeekday(dateStr)) {
        weekdays.push(dateStr);
      }
      current.setDate(current.getDate() + 1);
    }
    return weekdays;
  };

  // 🔥 NEW: Parse DD-MM-YYYY format to YYYY-MM-DD
  const parseDateDDMMYYYY = (dateStr) => {
    if (!dateStr || !dateStr.trim()) return null;
    const parts = dateStr.trim().split('-');
    if (parts.length !== 3) return null;
    const [day, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  };

  // 🔥 NEW: Convert YYYY-MM-DD to DD-MM-YYYY
  const formatDateDDMMYYYY = (dateStr) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}-${month}-${year}`;
  };

  // 🔥 AUTO-EXTEND LOGIC
  const calculateExtendedPlan = useCallback((firstDate, originalN, cancellations) => {
    if (!firstDate || !originalN) return [];
    
    const corePlan = getNextWeekdays(firstDate, originalN);
    const cancelledCount = cancellations.length;
    
    console.log(`🔄 Core Plan (N=${originalN}):`, corePlan);
    console.log(`🔄 Cancellations (X=${cancelledCount}):`, cancellations);
    
    if (cancelledCount === 0) {
      return corePlan;
    }
    
    const lastCoreDay = corePlan[corePlan.length - 1];
    const nextDay = new Date(lastCoreDay + 'T12:00:00');
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().split('T')[0];
    const extensionDays = getNextWeekdays(nextDayStr, cancelledCount);
    
    const fullPlan = [...corePlan, ...extensionDays];
    console.log(`✅ Extended Plan (N+X = ${originalN}+${cancelledCount} = ${fullPlan.length}):`, fullPlan);
    
    return fullPlan;
  }, []);

  // 🔥 CALENDAR FUNCTIONS
  const todayStr = new Date().toISOString().split('T')[0];

  const currentPlanDates = useMemo(() => {
    if (newMarkedDays.length > 0) {
      return newMarkedDays;
    }
    return customerPlans.map(p => p.date?.split('T')[0]);
  }, [newMarkedDays, customerPlans]);

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push({ empty: true });
    }

    const planSet = new Set(currentPlanDates);
    const cancelSet = new Set(mealCancelledDates);
    const isNewPlan = newMarkedDays.length > 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      days.push({
        day,
        dateStr,
        isToday: dateStr === todayStr,
        isExistingPlan: planSet.has(dateStr) && !isNewPlan,
        isNewMarked: planSet.has(dateStr) && isNewPlan,
        isCancelled: cancelSet.has(dateStr),
        isWeekend: new Date(dateStr + 'T12:00:00').getDay() % 6 === 0,
        empty: false
      });
    }
    return days;
  }, [currentMonth, currentPlanDates, mealCancelledDates, newMarkedDays.length, todayStr]);

  // 🔥 MARK NEW PLAN - Updated to work with manual inputs
  const markNewPlan = () => {
    if (!manualPlanDays || !manualStartDate || !selectedCustomer) {
      setMessage('❌ Enter Plan Days and Start Date!');
      return;
    }
    
    const days = parseInt(manualPlanDays);
    if (isNaN(days) || days < 1) {
      setMessage('❌ Plan days must be a positive number!');
      return;
    }

    // Parse start date (DD-MM-YYYY format)
    const startDateParsed = parseDateDDMMYYYY(manualStartDate);
    if (!startDateParsed) {
      setMessage('❌ Invalid start date format! Use DD-MM-YYYY (e.g., 23-02-2026)');
      return;
    }
    
    // Get initial plan dates
    const planDaysArr = getNextWeekdays(startDateParsed, days);
    
    // Parse cancel dates if provided
    let cancelDatesArr = [];
    if (manualCancelDates.trim()) {
      cancelDatesArr = manualCancelDates
        .split(',')
        .map(d => parseDateDDMMYYYY(d))
        .filter(d => d !== null);
    }

    // Parse extended dates if provided
    let extendedDatesArr = [];
    if (manualExtendedDates.trim()) {
      extendedDatesArr = manualExtendedDates
        .split(',')
        .map(d => parseDateDDMMYYYY(d))
        .filter(d => d !== null);
    }

    // Combine plan + extended dates
    const fullPlan = [...planDaysArr, ...extendedDatesArr];
    
    // Clear old state
    setCustomerPlans([]);
    setNewMarkedDays(fullPlan);
    setOriginalPlanLength(days);
    setMealCancelledDates(cancelDatesArr);
    setHasUnsavedChanges(true);
    lastExtendedPlanRef.current = fullPlan;
    
    console.log('🟢 NEW PLAN MARKED:', {
      plan: planDaysArr,
      cancelled: cancelDatesArr,
      extended: extendedDatesArr,
      total: fullPlan
    });
    
    setMessage(`✅ ${fullPlan.length} days marked (${planDaysArr.length} plan + ${extendedDatesArr.length} extended, ${cancelDatesArr.length} cancelled)`);
  };

  const handleDayClick = (dayData) => {
    if (dayData.empty || !selectedCustomer) return;
    
    // Copy date to clipboard in DD-MM-YYYY format
    const formattedDate = formatDateDDMMYYYY(dayData.dateStr);
    navigator.clipboard.writeText(formattedDate).then(() => {
      setMessage(`📋 Copied: ${formattedDate}`);
      // Clear message after 2 seconds
      setTimeout(() => setMessage(''), 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
      setMessage(`❌ Failed to copy date`);
    });
  };

  // Note: Auto-extend removed - using manual input instead

  // 🔥 SAVE PLAN - FIXED VERSION
  const savePlan = async () => {
    const planToSave = newMarkedDays.length > 0 ? newMarkedDays : currentPlanDates;
    
    if (planToSave.length === 0) {
      setMessage('❌ No plan to save! Mark a plan first.');
      return;
    }

    if (!selectedCustomer || !selectedMealType) {
      setMessage('❌ Missing customer or meal type!');
      return;
    }

    setLoading(true);
    try {
      console.log('💾 Saving plan:', {
        customer_id: selectedCustomer.id,
        customer_name: selectedCustomer.name,
        meal_type: selectedMealType,
        days: planToSave.length,
        cancellations: mealCancelledDates.length,
        original_plan_length: originalPlanLength
      });

      // Step 1: Delete old subscription plans for this meal type
      const { error: deleteError } = await supabase
        .from('subscriptions')
        .delete()
        .eq('customer_id', selectedCustomer.id)
        .eq(`meals->>${selectedMealType}`, 'true');

      if (deleteError) {
        console.error('Delete old plans error:', deleteError);
        throw deleteError;
      }

      // Step 2: Insert new subscription plans
      const planEntries = planToSave.map(date => ({
        customer_id: selectedCustomer.id,
        customer_name: selectedCustomer.name,
        date: date,
        status: 'active',
        meals: { [selectedMealType]: true },
        metadata: { original_plan_length: originalPlanLength || planToSave.length }
      }));

      const { error: planError } = await supabase
        .from('subscriptions')
        .insert(planEntries);
      
      if (planError) {
        console.error('Plan insert error:', planError);
        throw planError;
      }

      // Step 3: Delete old cancellations for this meal type
      const { error: deleteCancelsError } = await supabase
        .from('meal_cancellations')
        .delete()
        .eq('customer_id', selectedCustomer.id)
        .eq('meal_type', selectedMealType);

      if (deleteCancelsError) {
        console.error('Delete cancellations error:', deleteCancelsError);
        throw deleteCancelsError;
      }

      // Step 4: Insert new cancellations
      if (mealCancelledDates.length > 0) {
        const cancellations = mealCancelledDates.map(date => ({
          customer_id: selectedCustomer.id,
          date: date,
          meal_type: selectedMealType
        }));
        
        const { error: cancelError } = await supabase
          .from('meal_cancellations')
          .insert(cancellations);
        
        if (cancelError) {
          console.error('Cancellation insert error:', cancelError);
          throw cancelError;
        }
      }

      const activeCount = planToSave.filter(d => !mealCancelledDates.includes(d)).length;
      setMessage(`✅ SAVED! ${activeCount} active | ${mealCancelledDates.length} cancelled | ${planToSave.length} total`);
      
      setHasUnsavedChanges(false);
      lastExtendedPlanRef.current = planToSave;
      
      console.log('✅ Save successful!');
      
      // Reload the data to confirm it's saved
      await selectMealType(selectedMealType);
    } catch (error) {
      setMessage(`❌ Save failed: ${error.message}`);
      console.error('Save error:', error);
    } finally {
      setLoading(false);
    }
  };

  // 🔥 STYLES
  const styles = {
    container: { minHeight: '100vh', background: 'linear-gradient(135deg, #1a202c 0%, #2d3748 100%)', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', color: 'white', padding: '40px 20px', maxWidth: '1200px', margin: '0 auto' },
    header: { textAlign: 'center', marginBottom: '50px', fontSize: '48px', fontWeight: 800, background: 'linear-gradient(135deg, #ffffff 0%, #e2e8f0 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
    card: { background: 'rgba(255,255,255,0.08)', borderRadius: '20px', padding: '40px', backdropFilter: 'blur(10px)', marginBottom: '30px', border: '1px solid rgba(255,255,255,0.1)' },
    title: { fontSize: '28px', fontWeight: 700, marginBottom: '30px', color: '#e2e8f0', textAlign: 'center' },
    customerGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px', marginTop: '20px' },
    customerCard: { background: 'rgba(255,255,255,0.1)', padding: '25px', borderRadius: '15px', cursor: 'pointer', border: '2px solid transparent', transition: 'all 0.3s ease', textAlign: 'center' },
    formGroup: { marginBottom: '25px' },
    label: { display: 'block', marginBottom: '8px', fontWeight: 600, color: '#e2e8f0' },
    input: { width: '100%', padding: '16px 20px', background: 'rgba(255,255,255,0.1)', border: '2px solid rgba(255,255,255,0.2)', borderRadius: '12px', color: 'white', fontSize: '16px' },
    btnPrimary: { padding: '16px 32px', background: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)', color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.3s ease' },
    mealGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '25px', marginTop: '30px' },
    mealCard: { background: 'rgba(255,255,255,0.1)', padding: '40px 30px', borderRadius: '20px', textAlign: 'center', cursor: 'pointer', border: '3px solid transparent', transition: 'all 0.3s ease' },
    backBtn: { position: 'fixed', top: '30px', left: '30px', padding: '12px 20px', background: 'rgba(0,0,0,0.7)', color: 'white', border: 'none', borderRadius: '25px', fontWeight: 600, cursor: 'pointer', zIndex: 1000 },
    calendarSection: { background: 'rgba(255,255,255,0.05)', borderRadius: '20px', padding: '30px', margin: '20px 0', backdropFilter: 'blur(10px)' },
    calendarHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '25px' },
    navBtn: { width: '44px', height: '44px', borderRadius: '50%', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', fontSize: '20px', fontWeight: 700, cursor: 'pointer' },
    monthTitle: { fontSize: '26px', fontWeight: 700, margin: 0 },
    weekdays: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px', marginBottom: '18px' },
    weekday: { padding: '12px 6px', textAlign: 'center', fontWeight: 600, color: '#a0aec0', fontSize: '14px' },
    calendarGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px' },
    day: { minHeight: '70px', padding: '12px', borderRadius: '12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 'bold', transition: 'all 0.3s ease' },
    message: { background: 'rgba(16,185,129,0.2)', border: '1px solid #34d399', borderRadius: '12px', padding: '20px', margin: '20px 0', textAlign: 'center', fontSize: '16px' },
    warningMessage: { background: 'rgba(251,191,36,0.2)', border: '1px solid #fbbf24', borderRadius: '12px', padding: '20px', margin: '20px 0', textAlign: 'center', fontSize: '16px' },
    loading: { textAlign: 'center', padding: '40px', fontSize: '18px' }
  };

  const getCalendarDayStyle = (dayData) => {
    if (dayData.empty) return { visibility: 'hidden', height: '70px' };
    
    let background = 'rgba(255,255,255,0.05)';
    let border = '1px solid rgba(255,255,255,0.1)';
    let cursor = 'default';

    if (dayData.isCancelled) {
      background = 'rgba(239,68,68,0.4)';
      border = '3px solid #ef4444';
      cursor = 'pointer';
    } else if (dayData.isNewMarked || dayData.isExistingPlan) {
      background = 'rgba(16,185,129,0.4)';
      border = '3px solid #10b981';
      cursor = 'pointer';
    } else if (dayData.isToday) {
      background = 'rgba(250,204,21,0.3)';
      border = '2px solid #facc15';
    }

    return { ...styles.day, background, border, cursor };
  };

  // 🔥 RENDER SCREENS
  const renderHomeScreen = () => (
    <div style={styles.card}>
      <h1 style={styles.header}>🍽️ Meal Plan Manager</h1>
      
      <div style={styles.card}>
        <h2 style={styles.title}>➕ Create New Customer</h2>
        <div style={styles.formGroup}>
          <label style={styles.label}>Name *</label>
          <input value={customerForm.name} onChange={(e) => handleCustomerFormChange('name', e.target.value)} style={styles.input} placeholder="Customer full name" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Phone</label>
          <input value={customerForm.phone} onChange={(e) => handleCustomerFormChange('phone', e.target.value)} style={styles.input} placeholder="Phone number" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Address</label>
          <input value={customerForm.address} onChange={(e) => handleCustomerFormChange('address', e.target.value)} style={styles.input} placeholder="Delivery address" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Google Maps Link</label>
          <input value={customerForm.googleMapLink} onChange={(e) => handleCustomerFormChange('googleMapLink', e.target.value)} style={styles.input} placeholder="https://maps.google.com/..." />
        </div>
        <button onClick={createNewCustomer} disabled={loading || !customerForm.name.trim()} style={{ ...styles.btnPrimary, width: '100%', opacity: loading || !customerForm.name.trim() ? 0.6 : 1, cursor: loading || !customerForm.name.trim() ? 'not-allowed' : 'pointer' }}>
          {loading ? '⏳ Creating...' : '✅ Create Customer'}
        </button>
      </div>

      <div style={styles.card}>
        <h2 style={styles.title}>👥 Existing Customers ({customers.length})</h2>
        {customers.length === 0 ? (
          <p style={{textAlign: 'center', color: '#a0aec0', fontSize: '18px'}}>No customers yet. Create one above!</p>
        ) : (
          <div style={styles.customerGrid}>
            {customers.map(customer => (
              <div key={customer.id} style={styles.customerCard} onClick={() => selectCustomerForMeals(customer)}>
                <h3 style={{margin: '0 0 15px 0', fontSize: '24px'}}>{customer.name}</h3>
                <div style={{color: '#a0aec0', marginBottom: '10px'}}>ID: {customer.id}</div>
                {customer.phone && <div style={{color: '#a0aec0', marginBottom: '10px'}}>📞 {customer.phone}</div>}
                {customer.address && <div style={{color: '#a0aec0', fontSize: '14px'}}>📍 {customer.address}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderCustomerMealsScreen = () => (
    <div>
      <button style={styles.backBtn} onClick={goBack}>← Back</button>
      <div style={styles.card}>
        <h2 style={styles.title}>{selectedCustomer.name} - Choose Meal Type</h2>
        <div style={styles.mealGrid}>
          <div style={styles.mealCard} onClick={() => selectMealType('breakfast')}>
            <div style={{fontSize: '48px', marginBottom: '20px'}}>🥐</div>
            <h3 style={{margin: '0 0 15px 0', fontSize: '28px'}}>Breakfast</h3>
            <div style={{color: '#a0aec0'}}>7:00 AM Delivery</div>
          </div>
          <div style={styles.mealCard} onClick={() => selectMealType('lunch')}>
            <div style={{fontSize: '48px', marginBottom: '20px'}}>🍲</div>
            <h3 style={{margin: '0 0 15px 0', fontSize: '28px'}}>Lunch</h3>
            <div style={{color: '#a0aec0'}}>1:00 PM Delivery</div>
          </div>
          <div style={styles.mealCard} onClick={() => selectMealType('dinner')}>
            <div style={{fontSize: '48px', marginBottom: '20px'}}>🍽️</div>
            <h3 style={{margin: '0 0 15px 0', fontSize: '28px'}}>Dinner</h3>
            <div style={{color: '#a0aec0'}}>7:00 PM Delivery</div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderCalendarScreen = () => (
    <div>
      <button style={styles.backBtn} onClick={goBack}>← Back to Meals</button>
      <div style={styles.card}>
        <h2 style={styles.title}>📅 {selectedCustomer.name} - {selectedMealType.charAt(0).toUpperCase() + selectedMealType.slice(1)} Calendar</h2>

        {hasUnsavedChanges && (
          <div style={styles.warningMessage}>⚠️ You have unsaved changes! Click "Save Changes" to update the database.</div>
        )}

        <div style={styles.calendarSection}>
          <div style={styles.calendarHeader}>
            <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))} style={styles.navBtn}>‹</button>
            <h3 style={styles.monthTitle}>{currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
            <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))} style={styles.navBtn}>›</button>
          </div>

          <div style={styles.weekdays}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day} style={styles.weekday}>{day}</div>)}
          </div>

          <div style={styles.calendarGrid}>
            {calendarDays.map((dayData, index) => (
              <div key={dayData.dateStr || index} style={getCalendarDayStyle(dayData)} onClick={() => handleDayClick(dayData)}>
                {!dayData.empty && (
                  <>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: 'white', marginBottom: '4px' }}>{dayData.day}</div>
                    {dayData.isCancelled && <div style={{ width: '16px', height: '16px', background: '#ef4444', borderRadius: '50%', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>❌</div>}
                    {!dayData.isCancelled && dayData.isExistingPlan && <div style={{ width: '16px', height: '16px', background: '#10b981', borderRadius: '50%', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>✓</div>}
                    {!dayData.isCancelled && dayData.isNewMarked && <div style={{ width: '16px', height: '16px', background: '#f6ad55', borderRadius: '50%', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>○</div>}
                  </>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', marginTop: '25px', fontSize: '16px', flexWrap: 'wrap' }}>
            <div>🟢 Active: {currentPlanDates.filter(d => !mealCancelledDates.includes(d)).length}</div>
            <div>❌ Cancelled: {mealCancelledDates.length}</div>
            <div>📅 Total: {currentPlanDates.length} days</div>
          </div>
        </div>

        {/* Simple Text Input Panel Below Calendar */}
        <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '15px', padding: '30px', marginTop: '30px' }}>
          <h3 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '25px', color: '#e2e8f0', textAlign: 'center' }}>📝 Plan Configuration</h3>
          
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Plan Days (number of weekdays)</label>
              <input 
                type="text" 
                value={manualPlanDays} 
                onChange={(e) => setManualPlanDays(e.target.value)} 
                style={styles.input} 
                placeholder="5"
              />
              <div style={{ fontSize: '13px', color: '#a0aec0', marginTop: '5px' }}>Example: 5</div>
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Start Date (DD-MM-YYYY)</label>
              <input 
                type="text" 
                value={manualStartDate} 
                onChange={(e) => setManualStartDate(e.target.value)} 
                style={styles.input}
                placeholder="23-02-2026"
              />
              <div style={{ fontSize: '13px', color: '#a0aec0', marginTop: '5px' }}>Example: 23-02-2026</div>
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Cancel Dates (comma separated, DD-MM-YYYY)</label>
              <input 
                type="text" 
                value={manualCancelDates} 
                onChange={(e) => setManualCancelDates(e.target.value)} 
                style={styles.input}
                placeholder="24-02-2026, 25-02-2026"
              />
              <div style={{ fontSize: '13px', color: '#a0aec0', marginTop: '5px' }}>Example: 24-02-2026, 25-02-2026</div>
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Extended Dates (comma separated, DD-MM-YYYY)</label>
              <input 
                type="text" 
                value={manualExtendedDates} 
                onChange={(e) => setManualExtendedDates(e.target.value)} 
                style={styles.input}
                placeholder="02-03-2026, 03-03-2026"
              />
              <div style={{ fontSize: '13px', color: '#a0aec0', marginTop: '5px' }}>Example: 02-03-2026, 03-03-2026 (to replace cancelled days)</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '30px' }}>
            <button onClick={markNewPlan} style={styles.btnPrimary}>✨ Apply Plan to Calendar</button>
            <button onClick={savePlan} disabled={loading || !hasUnsavedChanges} style={{ ...styles.btnPrimary, background: hasUnsavedChanges ? 'linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)' : 'rgba(100,116,139,0.5)', opacity: loading || !hasUnsavedChanges ? 0.6 : 1, cursor: loading || !hasUnsavedChanges ? 'not-allowed' : 'pointer' }}>
              {loading ? '⏳ Saving...' : hasUnsavedChanges ? '💾 Save to Database' : '✓ Saved'}
            </button>
          </div>
        </div>

        {message && <div style={styles.message}>{message}</div>}
      </div>
    </div>
  );

  return (
    <div style={styles.container}>
      {screen === 'home' && renderHomeScreen()}
      {screen === 'customerMeals' && renderCustomerMealsScreen()}
      {screen === 'calendar' && renderCalendarScreen()}
      {loading && <div style={styles.loading}>⏳ Loading...</div>}
    </div>
  );
}

export default App;
