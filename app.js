// ══════════════════════════════════════
// SUPABASE CLIENT
// ══════════════════════════════════════
const { createClient } = supabase;
const sb = createClient(
  'https://cqxezydojmuqloctqihk.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxeGV6eWRvam11cWxvY3RxaWhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3OTQ0ODgsImV4cCI6MjA5MDM3MDQ4OH0.ND6_vqHSE8nkTxgcE_RsaWU3QhtMZJqciCh1a-UKtwI'
);

// ══════════════════════════════════════
// STATE
// ══════════════════════════════════════
let currentRole = '';
let currentUser = null;
let selectedTeacherId = null;
let selectedClassId = null;
let TEACHERS = [];
let CLASSES = [];

// ══════════════════════════════════════
// BAD WORD FILTER (basic)
// ══════════════════════════════════════
const BAD_WORDS = ['stupid','idiot','dumb','hate','worst','terrible','awful','horrible','useless','waste','pathetic','moron','fool','garbage','trash','sucks','suck'];

function filterRemark(text) {
  if (!text) return '';
  let clean = text;
  BAD_WORDS.forEach(w => {
    const re = new RegExp('\\b' + w + '\\b', 'gi');
    clean = clean.replace(re, '***');
  });
  return clean;
}

// ══════════════════════════════════════
// SMART TAG SYSTEM
// ══════════════════════════════════════

// Curated tag dictionary — maps keywords to canonical tags with sentiment
const TAG_DICT = [
  // Teaching quality — positive
  { keys: ['clear','clarity','clearly','explains','explanation','understandable','easy to understand','simple'], tag: 'Clear Explanation', type: 'positive' },
  { keys: ['knowledgeable','knowledge','expert','knows','expertise','well versed','subject knowledge'], tag: 'Subject Expert', type: 'positive' },
  { keys: ['helpful','helps','help','supportive','support','assist','guidance'], tag: 'Helpful', type: 'positive' },
  { keys: ['patient','patience','calm','never rushes','takes time'], tag: 'Patient', type: 'positive' },
  { keys: ['engaging','engaged','interesting','interactive','fun','enjoyable','lively'], tag: 'Engaging', type: 'positive' },
  { keys: ['passionate','enthusiastic','motivated','dedicated','committed'], tag: 'Passionate', type: 'positive' },
  { keys: ['kind','friendly','approachable','warm','nice','gentle','welcoming'], tag: 'Approachable', type: 'positive' },
  { keys: ['punctual','on time','regular','disciplined','organized','systematic'], tag: 'Punctual', type: 'positive' },
  { keys: ['practical','examples','real world','application','demos','projects'], tag: 'Practical Focus', type: 'positive' },
  { keys: ['doubt','doubts','questions','answers questions','clears doubts'], tag: 'Clears Doubts', type: 'positive' },
  // Teaching quality — needs improvement
  { keys: ['fast','too fast','rushes','quick','speed','slow down'], tag: 'Too Fast', type: 'negative' },
  { keys: ['boring','monotone','dull','uninteresting','sleepy'], tag: 'Boring', type: 'negative' },
  { keys: ['unclear','confusing','confused','hard to understand','difficult to follow'], tag: 'Unclear', type: 'negative' },
  { keys: ['strict','harsh','rude','aggressive','scary','intimidating'], tag: 'Too Strict', type: 'negative' },
  { keys: ['absent','bunks','late','irregular','missed class'], tag: 'Irregular', type: 'negative' },
  { keys: ['could be better','not good enough','lacks depth','low interaction','no interaction'], tag: 'Low Interaction', type: 'negative' },
  { keys: ['partial','biased','favouritism','unfair'], tag: 'Biased', type: 'negative' },
  // Neutral / mixed
  { keys: ['notes','slides','material','resources','handouts'], tag: 'Good Notes', type: 'neutral' },
  { keys: ['assignment','assignments','homework','projects','tasks'], tag: 'Lots of Assignments', type: 'neutral' },
  { keys: ['exam','exams','test','marks','grading','lenient'], tag: 'Lenient Grading', type: 'neutral' },
];

function extractTags(remarks) {
  const found = {};
  // Only use actual non-empty student remarks, trimmed
  const cleanRemarks = remarks
    .filter(r => r && typeof r === 'string' && r.trim().length > 3)
    .map(r => r.trim().toLowerCase());

  if (!cleanRemarks.length) return [];

  // Match each remark individually so one remark = one vote per tag max
  // This prevents a single remark with many keywords from flooding tags
  cleanRemarks.forEach(remark => {
    const taggedThisRemark = new Set(); // each tag counted once per remark
    TAG_DICT.forEach(({ keys, tag, type }) => {
      if (taggedThisRemark.has(tag)) return;
      for (const k of keys) {
        // word-boundary match for single words, substring for phrases
        const pattern = k.includes(' ')
          ? k.replace(/\s+/g, '\\s+')
          : '\\b' + k + '\\b';
        if (new RegExp(pattern, 'i').test(remark)) {
          found[tag] = found[tag] || { count: 0, type };
          found[tag].count++;
          taggedThisRemark.add(tag);
          break; // first key match wins, move to next tag
        }
      }
    });
  });

  return Object.entries(found)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([tag, { count, type }]) => ({ word: tag, count, type }));
}

function isPositiveTag(word) { return false; } // type is now embedded in tag object

// ══════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════
function goTo(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + screen).classList.add('active');
}

function selectRole(role) {
  currentRole = role;
  document.getElementById('auth-title').textContent = role === 'student' ? 'Join as Student' : 'Join as Teacher';
  document.getElementById('auth-sub').textContent = role === 'student'
    ? 'Sign in to rate teachers anonymously.'
    : 'Sign in to rate your classes & view feedback.';
  document.getElementById('login-btn').className = role === 'teacher' ? 'btn btn-primary pink' : 'btn btn-primary';
  document.getElementById('signup-btn').className = role === 'teacher' ? 'btn btn-primary pink' : 'btn btn-primary';
  // Update label
  const codeEl = document.getElementById('signup-class-code');
  if (codeEl) {
    const lbl = codeEl.closest('.field').querySelector('label');
    if (lbl) lbl.textContent = role === 'teacher' ? 'Class Code you mentor' : 'Your Class Code';
  }
  goTo('auth');
}

function updateClassCode() {
  const sem     = document.getElementById('signup-sem').value;
  const group   = document.getElementById('signup-group').value;
  const section = document.getElementById('signup-section').value;
  const codeEl  = document.getElementById('signup-class-code');
  if (sem && group && section) {
    codeEl.value = sem + group + '-' + section;
  } else {
    codeEl.value = '';
  }
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0) === (tab === 'login'));
  });
  document.getElementById('login-fields').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('signup-fields').style.display = tab === 'signup' ? 'block' : 'none';
}

// ══════════════════════════════════════
// AUTH
// ══════════════════════════════════════
async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return showToast('Please fill in all fields', true);

  showToast('Signing in...');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return showToast('Login failed: ' + error.message, true);

  const { data: profile, error: pe } = await sb.from('users').select('*').eq('id', data.user.id).single();
  if (pe || !profile) return showToast('Profile not found. Please sign up.', true);
  if (profile.role !== currentRole) return showToast('Wrong role — please select ' + profile.role + ' on home screen.', true);

  await afterLogin(profile);
}

async function handleSignup() {
  const name      = document.getElementById('signup-name').value.trim();
  const email     = document.getElementById('signup-email').value.trim();
  const password  = document.getElementById('signup-password').value;
  const course    = document.getElementById('signup-course').value;
  const branch    = document.getElementById('signup-branch').value;
  const classCode = document.getElementById('signup-class-code').value.trim();

  if (!name || !email || !password || !course || !branch)
    return showToast('Please fill all required fields', true);
  if (!classCode)
    return showToast('Please select semester, group and section to generate your class code', true);
  if (password.length < 6)
    return showToast('Password must be at least 6 characters', true);

  showToast('Creating account...');
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) return showToast('Signup failed: ' + error.message, true);

  const extraData = {
    id: data.user.id,
    name,
    role: currentRole,
    email,
    course,
    branch,
    mentor_class: currentRole === 'teacher' ? classCode : null,
    student_class: currentRole === 'student' ? classCode : null,
  };

  const { error: profileError } = await sb.from('users').insert(extraData);
  if (profileError) return showToast('Profile error: ' + profileError.message, true);

  if (currentRole === 'teacher') {
    await sb.from('teachers').insert({
      user_id: data.user.id,
      subject: branch,
      department: branch,
    });

    // Create class entry using the generated code if not exists
    const { data: existingClass } = await sb.from('classes').select('id').eq('name', classCode).maybeSingle();
    if (!existingClass) {
      await sb.from('classes').insert({
        name: classCode,
        teacher_id: data.user.id,
        enrolled: 0,
      });
    }
  }

  await afterLogin({ ...extraData });
}

async function afterLogin(profile) {
  currentUser = profile;

  // Load teachers
  const { data: teacherRows } = await sb
    .from('teachers')
    .select('id, user_id, subject, department, users(id, name, course, branch)');

  const QUAL_LIST = [
    'Ph.D. in Computer Science, IIT Delhi',
    'M.Tech, NIT Trichy · 8 yrs experience',
    'Ph.D. in Electronics, IISc Bangalore',
    'M.E. in Information Technology · 5 yrs',
    'Ph.D. in AI/ML, IIT Bombay',
    'M.Tech Civil Engg, IIT Roorkee',
    'MBA, IIM Ahmedabad · Industry Expert',
    'M.Sc. Physics, University of Delhi',
  ];

  TEACHERS = (teacherRows || []).map((t, idx) => ({
    id: t.id,
    userId: t.user_id,
    name: t.users?.name || 'Unknown',
    subject: t.subject,
    dept: t.department,
    initials: initials(t.users?.name || 'XX'),
    qualification: QUAL_LIST[idx % QUAL_LIST.length],
    reviews: [],
  }));

  // Load reviews for each teacher (no student_id)
  for (const t of TEACHERS) {
    const { data: revs } = await sb
      .from('student_reviews')
      .select('knowledge, clarity, approachability, behaviour, remark, student_id')
      .eq('teacher_id', t.id);

    t.reviews = (revs || []).map(r => ({
      studentId: r.student_id,       // only used locally to detect own review
      knowledge: r.knowledge,
      clarity: r.clarity,
      approach: r.approachability,
      behaviour: r.behaviour,
      remark: filterRemark(r.remark),
    }));
  }

  // Load classes
  const { data: classRows } = await sb
    .from('classes')
    .select('id, name, teacher_id, enrolled, users(name)');

  // Load class ratings
  const { data: classRatings } = await sb
    .from('class_reviews')
    .select('class_id, engagement, participation, discipline, comment, teacher_id, users(name)');

  CLASSES = (classRows || []).map(c => {
    const rating = (classRatings || []).find(r => r.class_id === c.id);
    return {
      id: c.id,
      name: c.name,
      teacherId: c.teacher_id,
      teacherName: c.users?.name || '—',
      enrolled: c.enrolled || 0,
      rating: rating ? {
        engagement: rating.engagement,
        participation: rating.participation,
        discipline: rating.discipline,
        comment: filterRemark(rating.comment),
        ratedBy: rating.users?.name || '—',
        ratedById: rating.teacher_id,
      } : null,
    };
  });

  // Update stat
  document.getElementById('s-stat-teachers') && (document.getElementById('s-stat-teachers').textContent = TEACHERS.length);

  if (profile.role === 'student') {
    document.getElementById('s-avatar').textContent = profile.name.charAt(0).toUpperCase();
    document.getElementById('s-name').textContent = profile.name;
    document.getElementById('s-greet').textContent = profile.name.split(' ')[0];
    const classLabel = profile.student_class ? ` · Class ${profile.student_class}` : '';
    document.getElementById('s-course-branch').textContent = `${profile.course || ''} · ${profile.branch || ''}${classLabel}`;
    renderTeacherGrid('teachers-grid');
    // For students: only show their own class + all classes
    renderClassList('s-classes-list', false, profile.student_class);
    renderMyReviews();
    goTo('student');
  } else {
    document.getElementById('t-avatar').textContent = profile.name.charAt(0).toUpperCase();
    document.getElementById('t-name').textContent = profile.name;
    document.getElementById('t-greet').textContent = profile.name.split(' ')[0];
    document.getElementById('t-dept').textContent = `${profile.course || ''} · ${profile.branch || ''}`;
    renderMyFeedback();
    renderClassList('t-classes-list', true, null);
    renderTeacherGrid('t-teachers-grid');
    goTo('teacher');
  }

  showToast('Welcome, ' + profile.name.split(' ')[0] + '! 👋');
  buildTicker(); // refresh ticker with real data
}

async function logout() {
  await sb.auth.signOut();
  currentUser = null;
  TEACHERS = [];
  CLASSES = [];
  goTo('landing');
  showToast('Logged out');
}

// ══════════════════════════════════════
// RENDER: TEACHER GRID (Freelancer portrait style)
// ══════════════════════════════════════
function renderTeacherGrid(containerId) {
  const grid = document.getElementById(containerId);
  if (!TEACHERS.length) {
    grid.innerHTML = '<div class="empty-state">No teachers found. Teachers need to sign up first.</div>';
    return;
  }
  // Use container-specific prefix so IDs are unique across multiple grids
  const prefix = containerId === 't-teachers-grid' ? 'tg' : 'sg';
  grid.innerHTML = TEACHERS.map(t => teacherCardHTML(t, prefix)).join('');
}

function teacherCardHTML(t, prefix = 'sg') {
  const avg = parseFloat(calcAvg(t));
  const reviewCount = t.reviews.length;
  const canRate = currentUser?.role === 'student';
  const myReview = canRate ? t.reviews.find(r => r.studentId === currentUser.id) : null;
  const tags = extractTags(t.reviews.map(r => r.remark));

  // Star rating row
  const filled = avg ? Math.round(avg) : 0;
  const starsHTML = Array.from({length:5},(_,i) =>
    `<span class="pstar ${i < filled ? 'on' : ''}">${i < filled ? '★' : '☆'}</span>`
  ).join('');

  // Collapsed: just portrait + name + stars
  // Expanded: full breakdown + tags + rate button
  const dimsHTML = avg ? `
    <div class="p-dims">
      ${pDimHTML('Subject Knowledge', avgDim(t,'knowledge'))}
      ${pDimHTML('Teaching Clarity',  avgDim(t,'clarity'))}
      ${pDimHTML('Approachability',   avgDim(t,'approach'))}
      ${pDimHTML('Behaviour',         avgDim(t,'behaviour'))}
    </div>` : `<div style="font-size:13px;color:var(--muted);padding:8px 0">No ratings yet — be the first!</div>`;

  // Smart tags split by sentiment
  const posTags = tags.filter(t => t.type === 'positive');
  const negTags = tags.filter(t => t.type === 'negative');
  const neuTags = tags.filter(t => t.type === 'neutral');

  const tagSection = tags.length ? `
    <div class="p-tag-section">
      ${posTags.length ? `<div class="p-tag-group">
        ${posTags.map(t => `<span class="ptag pos"># ${t.word}</span>`).join('')}
      </div>` : ''}
      ${negTags.length ? `<div class="p-tag-group">
        ${negTags.map(t => `<span class="ptag neg"># ${t.word}</span>`).join('')}
      </div>` : ''}
      ${neuTags.length ? `<div class="p-tag-group">
        ${neuTags.map(t => `<span class="ptag neu"># ${t.word}</span>`).join('')}
      </div>` : ''}
    </div>` : '';

  // Rating verdict based on avg
  let verdict = '', verdictClass = '';
  if (avg >= 4.5)      { verdict = 'Excellent · Keep it up!';       verdictClass = 'v-great'; }
  else if (avg >= 3.5) { verdict = 'Good rating · Maintain status'; verdictClass = 'v-good'; }
  else if (avg >= 2.5) { verdict = 'Average · Room to improve';     verdictClass = 'v-avg'; }
  else if (avg > 0)    { verdict = 'Needs improvement';             verdictClass = 'v-bad'; }

  return `
  <div class="p-card" id="${prefix}-${t.id}">
    <!-- PORTRAIT HEADER — entire row is clickable -->
    <div class="p-portrait" onclick="toggleTeacherCard('${t.id}', '${prefix}')">
      <div class="p-avatar-wrap">
        <div class="p-avatar">${t.initials}</div>
        ${avg ? `<div class="p-avg-badge">${avg}</div>` : ''}
      </div>
      <div class="p-header-info">
        <div class="p-name">${t.name}</div>
        <div class="p-subject">${t.subject} · ${t.dept}</div>
        <div class="p-qual">${t.qualification}</div>
        <div class="p-stars-row">
          ${starsHTML}
          <span class="p-review-count">${reviewCount ? `${reviewCount} review${reviewCount>1?'s':''}` : 'No reviews yet'}</span>
        </div>
        ${verdict ? `<div class="p-verdict ${verdictClass}">${verdict}</div>` : ''}
      </div>
      <div class="p-chevron" id="chev-${prefix}-${t.id}" aria-hidden="true">⌄</div>
    </div>

    <!-- EXPANDED DETAIL -->
    <div class="p-detail" id="pd-${prefix}-${t.id}">
      <div class="p-detail-inner">
        ${dimsHTML}
        ${tagSection}
        ${canRate ? `<button class="p-rate-btn" onclick="event.stopPropagation(); openRateTeacher('${t.id}', event)">
          ${myReview ? '✏️ Edit your review' : '+ Rate this teacher'}
        </button>` : ''}
      </div>
    </div>
  </div>`;
}

function pDimHTML(label, val) {
  const pct = val !== '—' ? (parseFloat(val) / 5 * 100) : 0;
  const color = pct >= 80 ? 'var(--accent3)' : pct >= 60 ? 'var(--accent)' : pct >= 40 ? 'var(--warn)' : 'var(--accent2)';
  return `
  <div class="p-dim-row">
    <span class="p-dim-label">${label}</span>
    <div class="p-dim-track"><div class="p-dim-fill" style="width:${pct}%;background:${color}"></div></div>
    <span class="p-dim-val">${val}</span>
  </div>`;
}

function dimBarHTML(label, val) {
  const pct = val !== '—' ? (parseFloat(val) / 5 * 100) : 0;
  return `
  <div class="dim-bar">
    <div class="dim-bar-label">${label}</div>
    <div class="dim-bar-row">
      <div class="dim-bar-track"><div class="dim-bar-fill" style="width:${pct}%"></div></div>
      <div class="dim-bar-val">${val}</div>
    </div>
  </div>`;
}

function toggleTeacherCard(teacherId, prefix = 'sg') {
  const detail = document.getElementById('pd-' + prefix + '-' + teacherId);
  const card   = document.getElementById(prefix + '-' + teacherId);
  const chev   = document.getElementById('chev-' + prefix + '-' + teacherId);
  if (!detail) return;
  const isOpen = detail.classList.contains('open');
  detail.classList.toggle('open', !isOpen);
  card.classList.toggle('expanded', !isOpen);
  if (chev) chev.style.transform = isOpen ? '' : 'rotate(180deg)';
}

function toggleCard(id, e) {
  if (e) e.stopPropagation();
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('expanded');
}

function toggleClassCard(classId) {
  const detail = document.getElementById('cd-' + classId);
  const card   = document.getElementById('class-' + classId);
  const chev   = document.getElementById('cchev-' + classId);
  if (!detail) return;
  const isOpen = detail.classList.contains('open');
  detail.classList.toggle('open', !isOpen);
  card.classList.toggle('expanded', !isOpen);
  if (chev) chev.style.transform = isOpen ? '' : 'rotate(180deg)';
}

// Also re-export toggleTeacherCard for teacher dashboard teacher list
// (it already works, no change needed)

// ══════════════════════════════════════
// RENDER: CLASS LIST (portrait style)
// ══════════════════════════════════════
function renderClassList(containerId, isTeacher, studentClass = null) {
  const container = document.getElementById(containerId);
  if (!CLASSES.length) {
    container.innerHTML = '<div class="empty-state">No classes found.</div>';
    return;
  }
  container.innerHTML = CLASSES.map(c => classCardHTML(c, isTeacher, studentClass)).join('');
}

function classCardHTML(c, isTeacher, studentClass) {
  const r = c.rating;
  const isMyClass = studentClass && c.name === studentClass;
  const alreadyRatedByMe = isTeacher && r && r.ratedById === currentUser?.id;

  // Avg score from all three dims
  const classAvg = r ? ((r.engagement + r.participation + r.discipline) / 3).toFixed(1) : 0;
  const filled = classAvg ? Math.round(classAvg) : 0;
  const starsHTML = Array.from({length:5},(_,i) =>
    `<span class="pstar ${i < filled ? 'on' : ''}">${i < filled ? '★' : '☆'}</span>`
  ).join('');

  // Verdict
  let verdict = '', verdictClass = '';
  if (classAvg >= 4.5)      { verdict = 'Highly Engaged';       verdictClass = 'v-great'; }
  else if (classAvg >= 3.5) { verdict = 'Good Class';           verdictClass = 'v-good';  }
  else if (classAvg >= 2.5) { verdict = 'Average Engagement';   verdictClass = 'v-avg';   }
  else if (classAvg > 0)    { verdict = 'Needs Attention';      verdictClass = 'v-bad';   }

  // Tags from comment
  const tags = r ? extractTags([r.comment]) : [];
  const tagsHTML = tags.length
    ? tags.map(t => `<span class="ptag ${t.type === 'positive' ? 'pos' : t.type === 'negative' ? 'neg' : 'neu'}"># ${t.word}</span>`).join('')
    : '';

  const rateBtn = isTeacher
    ? `<button class="p-rate-btn" style="margin-top:0" onclick="event.stopPropagation(); openRateClass('${c.id}', event)">
        ${(r && alreadyRatedByMe) ? '✏️ Update your rating' : '+ Rate this class'}
       </button>`
    : '';

  const expandedContent = r ? `
    <div class="p-detail-inner">
      <div class="p-dims">
        ${pDimHTML('Engagement',    r.engagement + '')}
        ${pDimHTML('Participation', r.participation + '')}
        ${pDimHTML('Discipline',    r.discipline + '')}
      </div>
      ${r.comment ? `<div class="fb-remark-pill" style="margin-bottom:12px">"${r.comment}"</div>` : ''}
      ${tags.length ? `<div class="tags-wrap" style="margin-bottom:12px">${tagsHTML}</div>` : ''}
      <div style="font-size:12px;color:var(--muted)">Rated by <strong style="color:var(--accent2)">${r.ratedBy}</strong></div>
      ${rateBtn}
    </div>` : `
    <div class="p-detail-inner">
      <div style="color:var(--muted);font-size:13px;margin-bottom:14px">No rating submitted yet.</div>
      ${rateBtn}
    </div>`;

  return `
  <div class="p-card ${isMyClass ? 'my-class' : ''}" id="class-${c.id}">
    <div class="p-portrait" onclick="toggleClassCard('${c.id}')">
      <div class="p-avatar-wrap">
        <div class="p-avatar" style="border-radius:12px;background:linear-gradient(135deg,#ff658422,#f39c1222);font-size:22px">🏫</div>
        ${classAvg ? `<div class="p-avg-badge" style="background:var(--accent2)">${classAvg}</div>` : ''}
      </div>
      <div class="p-header-info">
        <div class="p-name">${c.name}</div>
        <div class="p-subject">Mentor: ${c.teacherName}</div>
        <div class="p-stars-row">
          ${r ? starsHTML : ''}
          <span class="p-review-count">${r ? `Rated · ${r.ratedBy}` : 'Not yet rated'}</span>
        </div>
        ${verdict ? `<div class="p-verdict ${verdictClass}">${verdict}</div>` : ''}
      </div>
      <div class="p-chevron" id="cchev-${c.id}" aria-hidden="true">⌄</div>
    </div>
    <div class="p-detail" id="cd-${c.id}">
      ${expandedContent}
    </div>
  </div>`;
}

// ══════════════════════════════════════
// RENDER: MY REVIEWS (student)
// ══════════════════════════════════════
function renderMyReviews() {
  const container = document.getElementById('my-reviews-list');
  const mine = [];
  TEACHERS.forEach(t => {
    const r = t.reviews.find(r => r.studentId === currentUser.id);
    if (r) mine.push({ teacher: t, review: r });
  });

  document.getElementById('s-stat-given').textContent = mine.length;

  if (!mine.length) {
    container.innerHTML = '<div class="empty-state">No reviews yet. Rate a teacher above!</div>';
    return;
  }

  container.innerHTML = mine.map(({ teacher, review }) => `
    <div class="review-row">
      <div class="review-row-info">
        <div class="review-row-name">${teacher.name} — ${teacher.subject}</div>
        ${review.remark ? `<div class="review-row-remark">"${review.remark}"</div>` : ''}
      </div>
      <div class="review-scores">
        <div class="mini-chip">Know <b>${review.knowledge}</b></div>
        <div class="mini-chip">Clarity <b>${review.clarity}</b></div>
        <div class="mini-chip">Approach <b>${review.approach}</b></div>
        <div class="mini-chip">Behaviour <b>${review.behaviour}</b></div>
      </div>
      <button class="edit-review-btn" onclick="openRateTeacher('${teacher.id}')">✏️ Edit</button>
    </div>`).join('');
}

// ══════════════════════════════════════
// RENDER: TEACHER'S OWN FEEDBACK
// ══════════════════════════════════════
function renderMyFeedback() {
  const me = TEACHERS.find(t => t.userId === currentUser.id);
  const card = document.getElementById('t-feedback-card');
  const statAvg = document.getElementById('t-stat-avg');
  const statRev = document.getElementById('t-stat-reviews');

  // Classes rated count
  const myClasses = CLASSES.filter(c => c.teacherId === currentUser.id);
  const ratedCount = myClasses.filter(c => c.rating).length;
  document.getElementById('t-stat-classes').textContent = ratedCount;

  if (!me || !me.reviews.length) {
    card.innerHTML = '<div class="empty-state">No student reviews received yet.</div>';
    statAvg.textContent = '—';
    statRev.textContent = '0';
    return;
  }

  const avg = parseFloat(calcAvg(me));
  statAvg.textContent = avg.toFixed(1);
  statRev.textContent = me.reviews.length;

  // Verdict
  let verdict = '', verdictClass = '', verdictIcon = '';
  if (avg >= 4.5)      { verdict = 'Excellent — keep it up!';        verdictClass = 'v-great'; verdictIcon = '🏆'; }
  else if (avg >= 3.5) { verdict = 'Good — maintain the standard';   verdictClass = 'v-good';  verdictIcon = '👍'; }
  else if (avg >= 2.5) { verdict = 'Average — room to grow';         verdictClass = 'v-avg';   verdictIcon = '📈'; }
  else                 { verdict = 'Needs attention';                 verdictClass = 'v-bad';   verdictIcon = '⚠️'; }

  const dims = [
    { key: 'knowledge', label: 'Subject Knowledge', icon: '📚' },
    { key: 'clarity',   label: 'Teaching Clarity',  icon: '💡' },
    { key: 'approach',  label: 'Approachability',   icon: '🤝' },
    { key: 'behaviour', label: 'Behaviour',          icon: '⭐' },
  ];

  // Best and weakest dim
  const dimVals = dims.map(d => ({ ...d, val: parseFloat(avgDim(me, d.key)) || 0 }));
  const best    = dimVals.reduce((a,b) => a.val > b.val ? a : b);
  const weakest = dimVals.reduce((a,b) => a.val < b.val ? a : b);

  const dimsHTML = dimVals.map(d => {
    const pct = (d.val / 5 * 100);
    const color = pct >= 80 ? 'var(--accent3)' : pct >= 60 ? 'var(--accent)' : pct >= 40 ? 'var(--warn)' : 'var(--accent2)';
    const isBest = d.key === best.key;
    return `
    <div class="fb-dim ${isBest ? 'fb-dim-best' : ''}">
      <div class="fb-dim-top">
        <span class="fb-dim-icon">${d.icon}</span>
        <span class="fb-dim-label">${d.label}</span>
        ${isBest ? '<span class="fb-best-badge">Best</span>' : ''}
      </div>
      <div class="fb-dim-val-row">
        <div class="fb-dim-track">
          <div class="fb-dim-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="fb-dim-num" style="color:${color}">${d.val.toFixed(1)}</span>
      </div>
    </div>`;
  }).join('');

  // Tags — split by type
  const tags    = extractTags(me.reviews.map(r => r.remark));
  const posTags = tags.filter(t => t.type === 'positive');
  const negTags = tags.filter(t => t.type === 'negative');

  const tagSection = tags.length ? `
    <div class="fb-tags-section">
      <div class="fb-tags-title">What students say</div>
      ${posTags.length ? `<div class="fb-tag-row">
        <span class="fb-tag-lead pos">👍 Strengths</span>
        ${posTags.map(t => `<span class="ptag pos"># ${t.word}</span>`).join('')}
      </div>` : ''}
      ${negTags.length ? `<div class="fb-tag-row">
        <span class="fb-tag-lead neg">💬 Feedback</span>
        ${negTags.map(t => `<span class="ptag neg"># ${t.word}</span>`).join('')}
      </div>` : ''}
    </div>` : '';

  // Remarks (anonymised)
  const remarks = me.reviews.filter(r => r.remark).slice(0, 5);
  const remarksHTML = remarks.length ? `
    <div class="fb-remarks">
      <div class="fb-tags-title">Recent remarks</div>
      ${remarks.map(r => `<div class="fb-remark-pill">"${r.remark}"</div>`).join('')}
    </div>` : '';

  card.innerHTML = `
    <div class="fb-hero">
      <div class="fb-score-block">
        <div class="fb-big-num">${avg.toFixed(1)}</div>
        <div class="fb-out-of">/ 5.0</div>
      </div>
      <div class="fb-hero-right">
        <div class="fb-verdict-pill ${verdictClass}">${verdictIcon} ${verdict}</div>
        <div class="fb-hero-stats">
          <span>${me.reviews.length} student${me.reviews.length > 1 ? 's' : ''} reviewed you</span>
          <span class="fb-sep">·</span>
          <span>Best: ${best.label}</span>
          ${avg < 5 ? `<span class="fb-sep">·</span><span>Improve: ${weakest.label}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="fb-dims">${dimsHTML}</div>
    ${tagSection}
    ${remarksHTML}
  `;
}

// ══════════════════════════════════════
// RATE TEACHER MODAL
// ══════════════════════════════════════
function openRateTeacher(teacherId, e) {
  if (e) e.stopPropagation();
  selectedTeacherId = teacherId;
  const t = TEACHERS.find(t => t.id === teacherId);
  document.getElementById('rt-modal-title').textContent = 'Rate ' + t.name;

  // prefill if editing
  const existing = t.reviews.find(r => r.studentId === currentUser.id);
  setSlider('sl-knowledge', 'v-knowledge', existing?.knowledge || 3);
  setSlider('sl-clarity',   'v-clarity',   existing?.clarity   || 3);
  setSlider('sl-approach',  'v-approach',  existing?.approach  || 3);
  setSlider('sl-behaviour', 'v-behaviour', existing?.behaviour || 3);
  document.getElementById('rt-remark').value = existing?.remark || '';

  openModal('rate-teacher-modal');
}

async function submitTeacherReview() {
  const knowledge  = +document.getElementById('sl-knowledge').value;
  const clarity    = +document.getElementById('sl-clarity').value;
  const approach   = +document.getElementById('sl-approach').value;
  const behaviour  = +document.getElementById('sl-behaviour').value;
  const remark     = filterRemark(document.getElementById('rt-remark').value.trim());

  showToast('Submitting...');

  // Check if existing review → upsert
  const { data: existing } = await sb
    .from('student_reviews')
    .select('id')
    .eq('teacher_id', selectedTeacherId)
    .eq('student_id', currentUser.id)
    .maybeSingle();

  let error;
  if (existing) {
    ({ error } = await sb.from('student_reviews').update({
      knowledge, clarity, approachability: approach, behaviour, remark: remark || null,
    }).eq('id', existing.id));
  } else {
    ({ error } = await sb.from('student_reviews').insert({
      teacher_id: selectedTeacherId,
      student_id: currentUser.id,
      knowledge, clarity, approachability: approach, behaviour, remark: remark || null,
    }));
  }

  if (error) return showToast('Failed: ' + error.message, true);

  // update local state
  const t = TEACHERS.find(t => t.id === selectedTeacherId);
  t.reviews = t.reviews.filter(r => r.studentId !== currentUser.id);
  t.reviews.push({ studentId: currentUser.id, knowledge, clarity, approach, behaviour, remark });

  closeModal('rate-teacher-modal');
  renderTeacherGrid('teachers-grid');
  renderMyReviews();
  showToast(existing ? 'Review updated ✓' : 'Review submitted anonymously ✓');
}

// ══════════════════════════════════════
// RATE CLASS MODAL
// ══════════════════════════════════════
function openRateClass(classId, e) {
  if (e) e.stopPropagation();
  selectedClassId = classId;
  const c = CLASSES.find(c => c.id === classId);
  document.getElementById('rc-modal-title').textContent = 'Rate ' + c.name;

  setSlider('sl-engage', 'v-engage', c.rating?.engagement || 3);
  setSlider('sl-part',   'v-part',   c.rating?.participation || 3);
  setSlider('sl-disc',   'v-disc',   c.rating?.discipline || 3);
  document.getElementById('rc-comment').value = c.rating?.comment || '';

  openModal('rate-class-modal');
}

async function submitClassReview() {
  const engagement    = +document.getElementById('sl-engage').value;
  const participation = +document.getElementById('sl-part').value;
  const discipline    = +document.getElementById('sl-disc').value;
  const comment       = filterRemark(document.getElementById('rc-comment').value.trim());

  showToast('Submitting...');

  // upsert — check if THIS teacher already rated this class
  const { data: existing } = await sb
    .from('class_reviews')
    .select('id')
    .eq('class_id', selectedClassId)
    .eq('teacher_id', currentUser.id)
    .maybeSingle();

  let error;
  if (existing) {
    ({ error } = await sb.from('class_reviews').update({
      engagement, participation, discipline, comment: comment || null,
    }).eq('id', existing.id));
  } else {
    ({ error } = await sb.from('class_reviews').insert({
      class_id: selectedClassId,
      teacher_id: currentUser.id,
      engagement, participation, discipline, comment: comment || null,
    }));
  }

  if (error) return showToast('Failed: ' + error.message, true);

  // update local
  const c = CLASSES.find(c => c.id === selectedClassId);
  c.rating = { engagement, participation, discipline, comment, ratedBy: currentUser.name, ratedById: currentUser.id };

  closeModal('rate-class-modal');
  renderClassList('t-classes-list', true);
  renderMyFeedback();
  showToast('Class rated ✓');
}

// ══════════════════════════════════════
// HELPERS
// ══════════════════════════════════════
function calcAvg(teacher) {
  if (!teacher.reviews.length) return 0;
  const total = teacher.reviews.reduce((s, r) => s + (r.knowledge + r.clarity + r.approach + r.behaviour) / 4, 0);
  return (total / teacher.reviews.length).toFixed(1);
}

function avgDim(teacher, dim) {
  if (!teacher.reviews.length) return '—';
  return (teacher.reviews.reduce((s, r) => s + r[dim], 0) / teacher.reviews.length).toFixed(1);
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function setSlider(slId, valId, val) {
  const sl = document.getElementById(slId);
  sl.value = val;
  document.getElementById(valId).textContent = val;
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

function runSmartSearch(role) {
  const inputId = role === 'teacher' ? 't-smart-search' : 's-smart-search';
  const resultId = role === 'teacher' ? 't-search-result' : 's-search-result';
  const q = (document.getElementById(inputId)?.value || '').trim();
  const out = document.getElementById(resultId);
  if (!out) return;
  if (!q) {
    out.innerHTML = `
      <div class="smart-search-empty">
        <div class="smart-search-empty-title">Try a natural query</div>
        <div class="smart-search-empty-meta">Examples: "best environment for study", "best competitiveness", "best helpful teacher"</div>
      </div>`;
    return;
  }

  const text = q.toLowerCase();
  const teacherIntent = /(teacher|faculty|prof|mentor|helpful|approach|behavior|behaviour|clear|knowledge)/.test(text);
  const classIntent = /(class|environment|study|discipline|competitive|competitiveness|participation|engagement)/.test(text);

  if (teacherIntent && !classIntent) {
    return renderTeacherSearch(text, out, q);
  }
  if (classIntent && !teacherIntent) {
    return renderClassSearch(text, out, q);
  }
  // Ambiguous / mixed: show both best match blocks
  const teacherBlock = buildTeacherHits(text, 2).join('');
  const classBlock = buildClassHits(text, 2).join('');
  out.innerHTML = `
    <div class="smart-result-head">
      <div class="smart-result-title">Results for "${q}"</div>
      <div class="smart-result-sub">Showing both teachers and classes</div>
    </div>
    ${teacherBlock ? `<div class="smart-group-title">Top Teachers</div>${teacherBlock}` : ''}
    ${classBlock ? `<div class="smart-group-title">Top Classes</div>${classBlock}` : ''}
  `;
}

function renderTeacherSearch(text, container, queryText = '') {
  const hits = buildTeacherHits(text, 3);
  container.innerHTML = hits.length
    ? `
      <div class="smart-result-head">
        <div class="smart-result-title">Results for "${queryText}"</div>
        <div class="smart-result-sub">Teacher ranking based on matched metric</div>
      </div>
      ${hits.join('')}`
    : '<div class="smart-search-empty"><div class="smart-search-empty-meta">No teacher rating data yet.</div></div>';
}

function renderClassSearch(text, container, queryText = '') {
  const hits = buildClassHits(text, 3);
  container.innerHTML = hits.length
    ? `
      <div class="smart-result-head">
        <div class="smart-result-title">Results for "${queryText}"</div>
        <div class="smart-result-sub">Class ranking based on matched metric</div>
      </div>
      ${hits.join('')}`
    : '<div class="smart-search-empty"><div class="smart-search-empty-meta">No class ratings yet.</div></div>';
}

function buildTeacherHits(text, limit = 3) {
  const mode = /(helpful|approach|support|kind|behaviour|behavior)/.test(text)
    ? 'helpful'
    : /(clear|clarity|explain)/.test(text)
      ? 'clarity'
      : /(knowledge|expert|subject)/.test(text)
        ? 'knowledge'
        : 'overall';

  const rated = TEACHERS.filter(t => t.reviews.length > 0).map(t => {
    const knowledge = parseFloat(avgDim(t, 'knowledge')) || 0;
    const clarity = parseFloat(avgDim(t, 'clarity')) || 0;
    const approach = parseFloat(avgDim(t, 'approach')) || 0;
    const behaviour = parseFloat(avgDim(t, 'behaviour')) || 0;
    const overall = parseFloat(calcAvg(t)) || 0;
    const helpful = (approach + behaviour) / 2;
    const score = mode === 'helpful' ? helpful : mode === 'clarity' ? clarity : mode === 'knowledge' ? knowledge : overall;
    return { t, score, mode };
  }).sort((a, b) => b.score - a.score).slice(0, limit);

  return rated.map((r, i) => `
    <div class="smart-hit">
      <div class="smart-hit-top">
        <div class="smart-rank">#${i + 1}</div>
        <div class="smart-hit-title">${r.t.name}</div>
        <div class="smart-score-pill">${r.score.toFixed(1)} / 5.0</div>
      </div>
      <div class="smart-hit-meta">${r.t.subject} · ${r.t.dept}</div>
      <div class="smart-chip-row">
        <span class="smart-chip">Teacher</span>
        <span class="smart-chip metric">${teacherModeLabel(r.mode)}</span>
      </div>
    </div>`);
}

function buildClassHits(text, limit = 3) {
  const mode = /(environment|discipline|study environment|focused)/.test(text)
    ? 'discipline'
    : /(competitive|competitiveness|participation)/.test(text)
      ? 'participation'
      : /(engage|engagement|interactive)/.test(text)
        ? 'engagement'
        : 'overall';

  const rated = CLASSES.filter(c => c.rating).map(c => {
    const engagement = c.rating.engagement || 0;
    const participation = c.rating.participation || 0;
    const discipline = c.rating.discipline || 0;
    const overall = (engagement + participation + discipline) / 3;
    const score = mode === 'discipline' ? discipline : mode === 'participation' ? participation : mode === 'engagement' ? engagement : overall;
    return { c, score, mode };
  }).sort((a, b) => b.score - a.score).slice(0, limit);

  return rated.map((r, i) => `
    <div class="smart-hit">
      <div class="smart-hit-top">
        <div class="smart-rank">#${i + 1}</div>
        <div class="smart-hit-title">${r.c.name}</div>
        <div class="smart-score-pill">${r.score.toFixed(1)} / 5.0</div>
      </div>
      <div class="smart-hit-meta">Mentor: ${r.c.teacherName}</div>
      <div class="smart-chip-row">
        <span class="smart-chip">Class</span>
        <span class="smart-chip metric">${classModeLabel(r.mode)}</span>
      </div>
    </div>`);
}

function teacherModeLabel(mode) {
  if (mode === 'helpful') return 'Approachability + Behaviour';
  if (mode === 'clarity') return 'Teaching Clarity';
  if (mode === 'knowledge') return 'Subject Knowledge';
  return 'Overall Rating';
}

function classModeLabel(mode) {
  if (mode === 'discipline') return 'Discipline';
  if (mode === 'participation') return 'Participation';
  if (mode === 'engagement') return 'Engagement';
  return 'Overall Score';
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ══════════════════════════════════════
// ACHIEVEMENTS SYSTEM
// ══════════════════════════════════════
const ACHIEVEMENTS = [
  // Teacher achievements
  {
    id: 'hod',
    icon: '👑',
    title: 'Head of Department',
    desc: 'Top-rated teacher for 2 consecutive semesters gets promoted to HOD of their subject.',
    threshold: '4.8+ avg for 2 sems',
    type: 'teacher',
    color: '#f39c12',
    bg: '#f39c1215',
    border: '#f39c1233',
  },
  {
    id: 'star_teacher',
    icon: '⭐',
    title: 'Star Teacher of the Year',
    desc: 'Highest-rated teacher of the academic year gets felicitated at Annual Day.',
    threshold: 'Top 1 teacher annually',
    type: 'teacher',
    color: '#6c63ff',
    bg: '#6c63ff15',
    border: '#6c63ff33',
  },
  {
    id: 'mentor',
    icon: '🎓',
    title: 'Best Mentor Award',
    desc: 'Teacher with highest Approachability score gets Best Mentor certificate.',
    threshold: '4.5+ approachability',
    type: 'teacher',
    color: '#2ecc71',
    bg: '#2ecc7115',
    border: '#2ecc7133',
  },
  {
    id: 'consistency',
    icon: '📈',
    title: 'Consistency Champion',
    desc: 'Teacher maintaining 4.0+ rating for 3+ semesters gets priority timetable selection.',
    threshold: '4.0+ for 3 sems',
    type: 'teacher',
    color: '#3498db',
    bg: '#3498db15',
    border: '#3498db33',
  },
  {
    id: 'research',
    icon: '🔬',
    title: 'Research Grant Eligible',
    desc: 'Top 3 teachers per branch get first priority for college research funding.',
    threshold: 'Top 3 per branch',
    type: 'teacher',
    color: '#9b59b6',
    bg: '#9b59b615',
    border: '#9b59b633',
  },
  // Class achievements
  {
    id: 'hackathon',
    icon: '💻',
    title: 'Hackathon Sponsorship',
    desc: 'Top-rated class for the year gets full college funding for hackathon participation.',
    threshold: 'Top class of the year',
    type: 'class',
    color: '#2ecc71',
    bg: '#2ecc7115',
    border: '#2ecc7133',
  },
  {
    id: 'industry_visit',
    icon: '🏭',
    title: 'Industry Visit — Free',
    desc: 'Best engaged class gets a fully sponsored industry/company visit each semester.',
    threshold: '4.5+ engagement avg',
    type: 'class',
    color: '#e74c3c',
    bg: '#e74c3c15',
    border: '#e74c3c33',
  },
  {
    id: 'extra_lab',
    icon: '🧪',
    title: 'Priority Lab Access',
    desc: 'Top disciplined class gets first booking rights for all college lab sessions.',
    threshold: '4.5+ discipline',
    type: 'class',
    color: '#1abc9c',
    bg: '#1abc9c15',
    border: '#1abc9c33',
  },
  {
    id: 'fest',
    icon: '🎉',
    title: 'Fest Budget Bonus',
    desc: 'Highest participation class gets 30% extra budget for college fest activities.',
    threshold: 'Top participation score',
    type: 'class',
    color: '#f39c12',
    bg: '#f39c1215',
    border: '#f39c1233',
  },
  {
    id: 'trophy',
    icon: '🏆',
    title: 'Class of the Semester Trophy',
    desc: 'Best overall class displayed on the college notice board and social media.',
    threshold: 'Highest overall score',
    type: 'class',
    color: '#6c63ff',
    bg: '#6c63ff15',
    border: '#6c63ff33',
  },
];

function openAchievements() {
  // Compute current leaders from live data
  const topTeacher = TEACHERS.length
    ? TEACHERS.reduce((a,b) => parseFloat(calcAvg(a)||0) > parseFloat(calcAvg(b)||0) ? a : b)
    : null;

  const topClass = CLASSES.filter(c => c.rating).length
    ? CLASSES.filter(c => c.rating).reduce((a,b) => {
        const aAvg = (a.rating.engagement + a.rating.participation + a.rating.discipline) / 3;
        const bAvg = (b.rating.engagement + b.rating.participation + b.rating.discipline) / 3;
        return aAvg > bAvg ? a : b;
      })
    : null;

  const list = document.getElementById('ach-list');
  const topTeacherScore = topTeacher ? calcAvg(topTeacher) : null;
  const topClassScore = topClass
    ? ((topClass.rating.engagement + topClass.rating.participation + topClass.rating.discipline) / 3).toFixed(1)
    : null;
  const reviewedTeachers = TEACHERS.filter(t => t.reviews.length > 0).length;
  const ratedClasses = CLASSES.filter(c => c.rating).length;
  const rewardsTotal = ACHIEVEMENTS.length;
  const grantsAwarded = Math.max(1, Math.floor(ratedClasses / 2));

  list.innerHTML = `
    <div class="ach-board-hero">
      <div>
        <div class="ach-board-title">🏆 Achievements & Rewards</div>
        <div class="ach-board-sub">Unlock real college rewards by hitting top performance milestones.</div>
        <div class="ach-leaders">
          <div class="ach-leader-item">
            <div class="ach-leader-label">🌟 Top Teacher Now</div>
            <div class="ach-leader-name">${topTeacher ? topTeacher.name : 'No data yet'}</div>
            <div class="ach-leader-score">${topTeacher ? `${topTeacherScore} / 5.0` : 'Waiting for reviews'}</div>
          </div>
          <div class="ach-leader-item">
            <div class="ach-leader-label">🏫 Top Class Now</div>
            <div class="ach-leader-name">${topClass ? topClass.name : 'No data yet'}</div>
            <div class="ach-leader-score">${topClass ? `${topClassScore} / 5.0` : 'Waiting for ratings'}</div>
          </div>
        </div>
      </div>
      <div class="ach-trophy-panel">
        <div class="ach-trophy-icon">🏆</div>
        <div class="ach-trophy-text">Top performers get college-level recognition and perks.</div>
      </div>
    </div>

    <div class="ach-stats-strip">
      <div class="ach-stat-chip"><div class="ach-stat-val">👨‍🏫 ${reviewedTeachers}</div><div class="ach-stat-label">Top Teachers</div></div>
      <div class="ach-stat-chip"><div class="ach-stat-val">🏫 ${ratedClasses}</div><div class="ach-stat-label">Best Classes</div></div>
      <div class="ach-stat-chip"><div class="ach-stat-val">💜 ${rewardsTotal}</div><div class="ach-stat-label">Rewards Earned</div></div>
      <div class="ach-stat-chip"><div class="ach-stat-val">🎯 ${grantsAwarded}</div><div class="ach-stat-label">Grants Awarded</div></div>
    </div>

    <div class="ach-rewards-grid">
      ${ACHIEVEMENTS.map(a => achHTML(a)).join('')}
    </div>
  `;
  openModal('ach-modal');
}

function achHTML(a) {
  return `
  <div class="ach-card" style="border-color:${a.border};background:${a.bg}">
    <div class="ach-card-top">
      <div class="ach-icon" style="background:${a.bg};border-color:${a.border};color:${a.color}">${a.icon}</div>
      <div class="ach-title" style="color:${a.color}">${a.title}</div>
    </div>
    <div class="ach-body">
      <div class="ach-desc">${a.desc}</div>
      <div class="ach-threshold">◻ Criteria: ${a.threshold}</div>
    </div>
  </div>`;
}

// ══════════════════════════════════════
// LANDING TICKER
// ══════════════════════════════════════
function buildTicker() {
  const teachersTrack = document.getElementById('teachers-track');
  const classesTrack = document.getElementById('classes-track');
  if (!teachersTrack || !classesTrack) return;
  const TEMP_FACULTY_PICS = [
    'https://i.pravatar.cc/180?img=12',
    'https://i.pravatar.cc/180?img=15',
    'https://i.pravatar.cc/180?img=32',
    'https://i.pravatar.cc/180?img=45',
    'https://i.pravatar.cc/180?img=52',
    'https://i.pravatar.cc/180?img=56',
    'https://i.pravatar.cc/180?img=60',
    'https://i.pravatar.cc/180?img=68',
  ];

  const sortedTeachers = [...TEACHERS]
    .filter(t => t.reviews.length > 0)
    .sort((a,b) => parseFloat(calcAvg(b)||0) - parseFloat(calcAvg(a)||0))
    .slice(0, 8);

  const sortedClasses = [...CLASSES]
    .filter(c => c.rating)
    .sort((a,b) => {
      const aA = (a.rating.engagement + a.rating.participation + a.rating.discipline) / 3;
      const bA = (b.rating.engagement + b.rating.participation + b.rating.discipline) / 3;
      return bA - aA;
    })
    .slice(0, 8);

  const teacherCards = sortedTeachers.map((t, i) => {
    const avg = calcAvg(t);
    const pic = TEMP_FACULTY_PICS[i % TEMP_FACULTY_PICS.length];
    return `
      <div class="ticker-card">
        <img class="ticker-thumb" src="${pic}" alt="${t.name}" loading="lazy" />
        <div>
          <div class="ticker-name">${t.name}</div>
          <div class="ticker-meta">${t.subject} · ${t.dept}</div>
          <div class="ticker-score">★ ${avg}</div>
        </div>
      </div>`;
  });

  const classCards = sortedClasses.map(c => {
    const avg = ((c.rating.engagement + c.rating.participation + c.rating.discipline) / 3).toFixed(1);
    return `
      <div class="ticker-card">
        <div class="ticker-avatar" style="background:linear-gradient(135deg,#ff658433,#f39c1222);font-size:20px">🏫</div>
        <div>
          <div class="ticker-name">${c.name}</div>
          <div class="ticker-meta">Mentor: ${c.teacherName}</div>
          <div class="ticker-score" style="color:var(--accent2)">★ ${avg}</div>
        </div>
      </div>`;
  });

  if (!teacherCards.length) {
    ['Dr. Sharma','Prof. Gupta','Dr. Nair','Prof. Patel','Ms. Verma'].forEach((name, i) => {
      const avgs = ['4.9','4.8','4.7','4.6','4.5'];
      const subs = ['Data Structures','Operating Systems','AI/ML','Web Tech','Networks'];
      const pic = TEMP_FACULTY_PICS[i % TEMP_FACULTY_PICS.length];
      teacherCards.push(`
        <div class="ticker-card">
          <img class="ticker-thumb" src="${pic}" alt="${name}" loading="lazy" />
          <div>
            <div class="ticker-name">${name}</div>
            <div class="ticker-meta">${subs[i]}</div>
            <div class="ticker-score">★ ${avgs[i]}</div>
          </div>
        </div>`);
    });
  }

  if (!classCards.length) {
    ['OC-01','EP-03','OC-07','EP-10','OC-11'].forEach((code, i) => {
      const avgs = ['4.9','4.7','4.6','4.5','4.4'];
      const mentors = ['Dr. Sharma','Prof. Gupta','Dr. Nair','Prof. Patel','Ms. Verma'];
      classCards.push(`
        <div class="ticker-card">
          <div class="ticker-avatar" style="background:linear-gradient(135deg,#ff658433,#f39c1222);font-size:20px">🏫</div>
          <div>
            <div class="ticker-name">${code}</div>
            <div class="ticker-meta">Mentor: ${mentors[i]}</div>
            <div class="ticker-score" style="color:var(--accent2)">★ ${avgs[i]}</div>
          </div>
        </div>`);
    });
  }

  teachersTrack.innerHTML = [...teacherCards, ...teacherCards].join('');
  classesTrack.innerHTML = [...classCards, ...classCards].join('');
}

// Call buildTicker on page load (with placeholders), refresh after login
window.addEventListener('DOMContentLoaded', () => {
  buildTicker();
});
