import React, { useState, useEffect, useRef } from 'react';
import { AppStep, Post, UserProfile, FacebookLoginStatus, FacebookPage, MigrationMode } from './types';
import { Button } from './components/Button';
import { PostCard } from './components/PostCard';
import { MOCK_POSTS, MOCK_USER_NEW, MOCK_USER_OLD, MOCK_MANAGED_PAGES } from './services/mockData';
import { filterPostsWithGemini } from './services/geminiService';
import { fetchFacebookPosts, fetchFacebookProfile, fetchManagedPages } from './services/facebookService';

// Type definitions for Migration Log
type MigrationStatus = 'pending' | 'migrating' | 'success' | 'error';
interface MigrationLogItem {
  postId: string;
  contentPreview: string;
  status: MigrationStatus;
  error?: string;
}

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.LOGIN);
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [migrationMode, setMigrationMode] = useState<MigrationMode>('PROFILE_TO_PAGE');

  // --- ENVIRONMENT VARIABLES ---
  // Consumer ID: For reading Personal Profiles (user_posts)
  const appIdConsumer = 
    process.env.FACEBOOK_APP_ID_CONSUMER || 
    process.env.REACT_APP_FACEBOOK_APP_ID_CONSUMER || 
    ((import.meta as any).env && (import.meta as any).env.VITE_FACEBOOK_APP_ID_CONSUMER) || 
    '';

  // Business ID: For reading/writing Pages (pages_manage_posts, pages_show_list)
  const appIdBusiness = 
    process.env.FACEBOOK_APP_ID_BUSINESS || 
    process.env.REACT_APP_FACEBOOK_APP_ID_BUSINESS || 
    ((import.meta as any).env && (import.meta as any).env.VITE_FACEBOOK_APP_ID_BUSINESS) || 
    '';
  
  const [isSdkLoaded, setIsSdkLoaded] = useState(false);
  const [currentAppId, setCurrentAppId] = useState<string>('');
  
  // Connection State
  const isSecure = typeof window !== 'undefined' && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const [connectingTarget, setConnectingTarget] = useState<'source' | 'destination'>('source');
  
  const [accessToken, setAccessToken] = useState('');
  const [destinationAccessToken, setDestinationAccessToken] = useState('');
  const [manualTokenInput, setManualTokenInput] = useState('');
  const [isLoadingAuth, setIsLoadingAuth] = useState(false);
  const [oldConnected, setOldConnected] = useState(false);
  const [newConnected, setNewConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [httpsWarningDismissed, setHttpsWarningDismissed] = useState(false);

  // Page Selection State
  const [managedPages, setManagedPages] = useState<FacebookPage[]>([]);
  const [showPageSelector, setShowPageSelector] = useState(false);
  const [pageSelectorType, setPageSelectorType] = useState<'source' | 'destination'>('destination');

  // Data State
  const [currentUser, setCurrentUser] = useState<UserProfile>(MOCK_USER_OLD);
  const [destinationUser, setDestinationUser] = useState<UserProfile>(MOCK_USER_NEW);
  const [sourcePosts, setSourcePosts] = useState<Post[]>(MOCK_POSTS);
  
  // App Logic State
  const [filterText, setFilterText] = useState('');
  const [dateRange, setDateRange] = useState<{start: string, end: string}>({ start: '', end: '' });
  const [isListening, setIsListening] = useState(false);
  const [isFiltering, setIsFiltering] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState(0);
  const [includeMetadata, setIncludeMetadata] = useState(false);
  
  const [filteredPosts, setFilteredPosts] = useState<Post[]>([]);
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set());
  
  const [editablePosts, setEditablePosts] = useState<Post[]>([]);
  const [migrationLog, setMigrationLog] = useState<MigrationLogItem[]>([]);

  const recognitionRef = useRef<any>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // --- INITIALIZATION ---

  useEffect(() => {
    // Load SDK with a default ID (Consumer) initially to ensure object exists
    const defaultId = appIdConsumer || appIdBusiness;
    if (defaultId && !isSdkLoaded && (isSecure || httpsWarningDismissed)) {
       initSdk(defaultId);
    }
  }, [appIdConsumer, appIdBusiness, isSdkLoaded, isSecure, httpsWarningDismissed]);

  const initSdk = (appId: string) => {
    if ((window as any).FB) {
        // Re-init if already loaded
        (window as any).FB.init({
            appId: appId,
            cookie: true,
            xfbml: true,
            version: 'v19.0'
        });
        setCurrentAppId(appId);
        setIsSdkLoaded(true);
        console.log(`Facebook SDK Re-Initialized with ID: ${appId}`);
    } else {
        // Initial Load
        (window as any).fbAsyncInit = function() {
            (window as any).FB.init({
            appId: appId,
            cookie: true,
            xfbml: true,
            version: 'v19.0'
            });
            setCurrentAppId(appId);
            setIsSdkLoaded(true);
            console.log(`Facebook SDK Initialized with ID: ${appId}`);
        };
        (function(d, s, id){
            var js, fjs = d.getElementsByTagName(s)[0];
            if (d.getElementById(id)) {return;}
            js = d.createElement(s) as HTMLScriptElement; js.id = id;
            js.src = "https://connect.facebook.net/en_US/sdk.js";
            fjs.parentNode?.insertBefore(js, fjs);
        }(document, 'script', 'facebook-jssdk'));
    }
  };

  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';
      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setFilterText(transcript);
        setIsListening(false);
      };
      recognitionRef.current.onerror = (event: any) => { setIsListening(false); };
      recognitionRef.current.onend = () => { setIsListening(false); };
    }
  }, []);

  const handleMicClick = () => {
    if (isListening) recognitionRef.current?.stop();
    else { setIsListening(true); recognitionRef.current?.start(); }
  };

  const handleSwitchToHttps = () => {
    if (typeof window !== 'undefined') {
      window.location.href = window.location.href.replace(/^http:/, 'https:');
    }
  };

  // --- CONNECTION HANDLERS ---

  const handleConnectOldAccount = () => {
    setIsLoadingAuth(true);
    setTimeout(() => {
      // Logic for Demo Mode
      if (migrationMode === 'PAGE_TO_PAGE') {
        // If demoing Page to Page, show selection for source page
        setManagedPages(MOCK_MANAGED_PAGES);
        setPageSelectorType('source');
        setShowPageSelector(true);
      } else {
        // Profile to Page
        setOldConnected(true);
        setCurrentUser(MOCK_USER_OLD);
        setSourcePosts(MOCK_POSTS);
      }
      setIsLoadingAuth(false);
    }, 800);
  };

  const handleConnectNewAccount = () => {
    setIsLoadingAuth(true);
    setTimeout(() => {
      // In demo mode, we now show the page selector to choose the destination
      setManagedPages(MOCK_MANAGED_PAGES);
      setPageSelectorType('destination');
      setShowPageSelector(true);
      setIsLoadingAuth(false);
    }, 800);
  };

  const prepareConnection = (target: 'source' | 'destination') => {
    setConnectingTarget(target);
    setError(null);
    setShowPageSelector(false);

    // Determine correct App ID based on Mode and Target
    let requiredAppId = '';
    
    if (target === 'source') {
        // Source depends on mode
        if (migrationMode === 'PROFILE_TO_PAGE') requiredAppId = appIdConsumer;
        else requiredAppId = appIdBusiness;
    } else {
        // Destination is always a Page, so always Business App
        requiredAppId = appIdBusiness;
    }

    if (!requiredAppId) {
        setError(`Configuration Error: Missing App ID for ${target}. Check your .env file.`);
        return;
    }

    // Re-initialize SDK if needed
    if (currentAppId !== requiredAppId) {
        initSdk(requiredAppId);
    }
    
    // Slight delay to allow SDK init to process before triggering login
    setTimeout(() => {
        handleFacebookLogin(target);
    }, 200);
  };

  const handleFacebookLogin = (target: 'source' | 'destination') => {
    if (!isSecure && !httpsWarningDismissed) {
      setError("HTTPS required. Use button above to switch.");
      return;
    }

    if (!isSdkLoaded) {
      setError("SDK Loading... Try again.");
      return;
    }

    setIsLoadingAuth(true);

    // Determine scopes
    let scope = '';
    if (target === 'source') {
        if (migrationMode === 'PROFILE_TO_PAGE') {
            // Consumer App (Profile)
            scope = 'public_profile,user_posts'; 
        } else {
            // Business App (Page Source)
            scope = 'public_profile,pages_show_list,pages_read_engagement'; 
        }
    } else {
        // Business App (Page Destination)
        // 'pages_show_list' is CRITICAL here to fetch the list of pages
        scope = 'public_profile,pages_manage_posts,publish_pages,pages_show_list'; 
    }
    
    window.FB.login((response: FacebookLoginStatus) => {
        if (response.status === 'connected' && response.authResponse) {
            const token = response.authResponse.accessToken;
            fetchRealData(token, target);
        } else {
            setIsLoadingAuth(false);
            setError("Login cancelled or failed.");
        }
    }, { 
        scope: scope,
        auth_type: 'reauthenticate'
    });
  };

  const handleDisconnect = (target: 'source' | 'destination') => {
    // Reset specific connection state
    if (target === 'source') {
      setOldConnected(false);
      setAccessToken('');
      setSourcePosts([]); // Clear posts
      // Optionally reset currentUser to default if needed, though not strictly required as it's hidden
      setCurrentUser(MOCK_USER_OLD); 
    } else {
      setNewConnected(false);
      setDestinationAccessToken('');
      setDestinationUser(MOCK_USER_NEW);
    }
    setError(null);
  };

  const fetchRealData = async (token: string, target: 'source' | 'destination') => {
    setIsLoadingAuth(true);
    setError(null);

    try {
      if (target === 'source') {
        if (migrationMode === 'PROFILE_TO_PAGE') {
            // 1. Consumer Mode: Fetch Profile + Feed
            const profile = await fetchFacebookProfile(token);
            const posts = await fetchFacebookPosts(token, 'me/feed');
            
            if (posts.length === 0) setError("Connected, but found 0 posts.");
            
            setCurrentUser(profile);
            setSourcePosts(posts);
            setOldConnected(true);
            setAccessToken(token);
            setIsLoadingAuth(false);
        } else {
            // 2. Page Mode: Fetch Admin Pages -> User selects Page -> Fetch Page Feed
            const pages = await fetchManagedPages(token);
            if (pages.length === 0) {
                setError("No pages found on this account.");
                setIsLoadingAuth(false);
                return;
            }
            setManagedPages(pages);
            setPageSelectorType('source');
            setShowPageSelector(true);
            setIsLoadingAuth(false);
        }
      } else {
        // Destination: Always fetch Pages -> User selects Destination Page
        const pages = await fetchManagedPages(token);
        if (pages.length === 0) {
            setError("No pages found to publish to.");
            setIsLoadingAuth(false);
            return;
        }
        setManagedPages(pages);
        setPageSelectorType('destination');
        setShowPageSelector(true);
        setIsLoadingAuth(false);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to fetch data.");
      setIsLoadingAuth(false);
    }
  };

  const handleSelectPage = async (page: FacebookPage) => {
    // --- DEMO MODE LOGIC ---
    if (mode === 'demo') {
      if (pageSelectorType === 'source') {
        // Simulate loading source page
        setCurrentUser({
            name: page.name,
            handle: '@' + page.name.replace(/\s+/g, '').toLowerCase(),
            avatar: page.picture?.data?.url || 'https://via.placeholder.com/100'
        });
        setSourcePosts(MOCK_POSTS); // Load mock posts for demo
        setAccessToken('demo_token');
        setOldConnected(true);
      } else {
        // Simulate setting destination page
        setDestinationUser({
            name: page.name,
            handle: '@' + page.name.replace(/\s+/g, '').toLowerCase(),
            avatar: page.picture?.data?.url || 'https://via.placeholder.com/100'
        });
        setDestinationAccessToken('demo_token');
        setNewConnected(true);
      }
      setShowPageSelector(false);
      return;
    }

    // --- LIVE MODE LOGIC ---
    if (pageSelectorType === 'source') {
        // Fetch posts from this page
        setIsLoadingAuth(true);
        try {
            const posts = await fetchFacebookPosts(page.access_token, `${page.id}/feed`);
            setSourcePosts(posts);
            setCurrentUser({
                name: page.name,
                handle: '@' + page.name.replace(/\s+/g, '').toLowerCase(),
                avatar: page.picture?.data?.url || 'https://via.placeholder.com/100'
            });
            setAccessToken(page.access_token);
            setOldConnected(true);
        } catch (e: any) {
            setError("Failed to read page feed: " + e.message);
        }
        setIsLoadingAuth(false);
    } else {
        // Set Destination Page
        setDestinationUser({
            name: page.name,
            handle: '@' + page.name.replace(/\s+/g, '').toLowerCase(),
            avatar: page.picture?.data?.url || 'https://via.placeholder.com/100'
        });
        setDestinationAccessToken(page.access_token);
        setNewConnected(true);
    }
    setShowPageSelector(false);
  };

  // --- CORE APP LOGIC ---

  const handleAnalyze = async () => {
    if (!filterText.trim()) return;
    setIsFiltering(true);
    
    // 1. Filter by Date locally first to save AI context/cost
    let candidatePosts = sourcePosts;
    
    if (dateRange.start) {
        candidatePosts = candidatePosts.filter(p => p.date >= dateRange.start);
    }
    if (dateRange.end) {
        candidatePosts = candidatePosts.filter(p => p.date <= dateRange.end);
    }

    // 2. Filter by Topic using Gemini
    const matchingIds = await filterPostsWithGemini(candidatePosts, filterText);
    const relevant = candidatePosts.filter(p => matchingIds.includes(p.id));
    
    setFilteredPosts(relevant);
    setSelectedPostIds(new Set(relevant.map(p => p.id)));
    setIsFiltering(false);
    setStep(AppStep.REVIEW);
  };

  const handleToggleSelect = (id: string) => {
    const newSet = new Set(selectedPostIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedPostIds(newSet);
  };

  const handleSelectAll = () => {
    if (selectedPostIds.size === filteredPosts.length) setSelectedPostIds(new Set());
    else setSelectedPostIds(new Set(filteredPosts.map(p => p.id)));
  };

  const handleProceedToPreview = () => {
    const selected = filteredPosts.filter(p => selectedPostIds.has(p.id));
    setEditablePosts(JSON.parse(JSON.stringify(selected)));
    // Reset metadata toggle when entering preview
    setIncludeMetadata(false);
    setStep(AppStep.EDIT_PREVIEW);
  };

  const handleUpdatePost = (id: string, field: 'content' | 'imageUrl', value: string | undefined) => {
    setEditablePosts(prev => prev.map(post => post.id === id ? { ...post, [field]: value } : post));
  };

  const handleToggleMetadata = (shouldInclude: boolean) => {
    setIncludeMetadata(shouldInclude);
    setEditablePosts(currentPosts => currentPosts.map(post => {
      const footer = `\n\nOriginally posted on ${post.date} • ${post.likes} Likes`;
      if (shouldInclude) {
        // Only append if it's not already there (simple check)
        if (!post.content.endsWith(footer)) {
             return { ...post, content: post.content + footer };
        }
        return post;
      } else {
        // Remove the footer if it exists
        return { ...post, content: post.content.replace(footer, '') };
      }
    }));
  };

  const handleStartMigration = async () => {
    setStep(AppStep.MIGRATING);
    setIsMigrating(true);
    setMigrationProgress(0);
    const initialLog: MigrationLogItem[] = editablePosts.map(p => ({
      postId: p.id,
      contentPreview: p.content || (p.imageUrl ? 'Photo Post' : 'Untitled Post'),
      status: 'pending'
    }));
    setMigrationLog(initialLog);
    let completed = 0;
    for (const post of editablePosts) {
      setMigrationLog(prev => prev.map(item => item.postId === post.id ? { ...item, status: 'migrating' } : item));
      if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      await new Promise(resolve => setTimeout(resolve, 1200 + Math.random() * 500));
      const isSuccess = Math.random() > 0.05;
      setMigrationLog(prev => prev.map(item => item.postId === post.id ? { 
          ...item, status: isSuccess ? 'success' : 'error', error: isSuccess ? undefined : 'Connection timed out' 
      } : item));
      completed++;
      setMigrationProgress((completed / editablePosts.length) * 100);
    }
    await new Promise(resolve => setTimeout(resolve, 800));
    setIsMigrating(false);
    setStep(AppStep.COMPLETED);
  };

  const resetApp = () => {
    setStep(AppStep.FILTER_INPUT);
    setFilterText('');
    setDateRange({ start: '', end: '' });
    setFilteredPosts([]);
    setSelectedPostIds(new Set());
    setEditablePosts([]);
    setMigrationProgress(0);
    setMigrationLog([]);
    setIncludeMetadata(false);
  };

  const goToHome = () => {
    setStep(AppStep.LOGIN);
    setFilterText('');
    setDateRange({ start: '', end: '' });
    setFilteredPosts([]);
    setSelectedPostIds(new Set());
    setEditablePosts([]);
    setMigrationProgress(0);
    setMigrationLog([]);
    setIncludeMetadata(false);
  };

  // --- RENDER ---

  const renderLogin = () => {
    return (
      <div className="max-w-md mx-auto mt-10 p-8 bg-white rounded-xl shadow-lg border border-gray-100 relative">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-facebook-blue">SocialMigrate AI</h1>
          <div className="flex gap-2">
            <button onClick={() => { setMode('demo'); setOldConnected(false); setNewConnected(false); setShowPageSelector(false); }} className={`text-xs px-2 py-1 rounded ${mode === 'demo' ? 'bg-gray-200 font-bold' : 'text-gray-400'}`}>Demo</button>
            <button onClick={() => { setMode('live'); setOldConnected(false); setNewConnected(false); setShowPageSelector(false); }} className={`text-xs px-2 py-1 rounded ${mode === 'live' ? 'bg-red-100 text-red-600 font-bold' : 'text-gray-400'}`}>Live</button>
          </div>
        </div>

        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Select Migration Mode</label>
            <div className="flex gap-2">
               <button 
                 onClick={() => { setMigrationMode('PROFILE_TO_PAGE'); setOldConnected(false); setAccessToken(''); }}
                 className={`flex-1 py-2 px-3 text-xs rounded border transition-all ${migrationMode === 'PROFILE_TO_PAGE' ? 'bg-facebook-blue text-white border-facebook-blue shadow' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'}`}
               >
                 Profile <i className="fas fa-arrow-right mx-1"></i> Page
               </button>
               <button 
                 onClick={() => { setMigrationMode('PAGE_TO_PAGE'); setOldConnected(false); setAccessToken(''); }}
                 className={`flex-1 py-2 px-3 text-xs rounded border transition-all ${migrationMode === 'PAGE_TO_PAGE' ? 'bg-facebook-blue text-white border-facebook-blue shadow' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'}`}
               >
                 Page <i className="fas fa-arrow-right mx-1"></i> Page
               </button>
            </div>
            
            {/* HTTPS Warning / Dismissal for Live Mode */}
            {mode === 'live' && !isSecure && (
               <div className="mt-3">
                 {httpsWarningDismissed ? (
                    <div className="text-[10px] text-green-600 text-center"><i className="fas fa-check"></i> HTTPS Warning Dismissed</div>
                 ) : (
                    <div className="bg-yellow-50 p-2 rounded border border-yellow-200 text-center">
                        <div className="text-[10px] text-yellow-800 mb-1">Facebook Login requires HTTPS.</div>
                        <div className="flex justify-center gap-2">
                             <button onClick={handleSwitchToHttps} className="text-[10px] underline text-blue-600">Switch to HTTPS</button>
                             <button onClick={() => setHttpsWarningDismissed(true)} className="text-[10px] underline text-gray-500">Dismiss (Testing)</button>
                        </div>
                    </div>
                 )}
               </div>
            )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-600">
            <i className="fas fa-exclamation-circle mr-1"></i> {error}
          </div>
        )}
        
        {/* Page Selector Modal */}
        {showPageSelector && (
           <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg animate-fade-in">
             <h3 className="font-bold text-gray-800 mb-3 text-sm">
                 {pageSelectorType === 'source' ? 'Select Source Page' : 'Select Destination Page'}
             </h3>
             <div className="space-y-2 max-h-40 overflow-y-auto">
                {managedPages.map(page => (
                   <button 
                     key={page.id}
                     onClick={() => handleSelectPage(page)}
                     className="w-full flex items-center p-2 bg-white rounded border border-blue-100 hover:bg-blue-100 transition-colors text-left"
                   >
                      <img src={page.picture?.data?.url || 'https://via.placeholder.com/40'} className="w-8 h-8 rounded-full mr-3" alt="" />
                      <span className="text-sm font-medium text-gray-800">{page.name}</span>
                   </button>
                ))}
             </div>
             <button onClick={() => setShowPageSelector(false)} className="mt-3 text-xs text-gray-500 underline w-full text-center">Cancel</button>
           </div>
        )}

        {/* Source Card */}
        <div className="mb-4">
            <div className={`p-4 border rounded-lg flex items-center justify-between ${oldConnected ? 'bg-blue-50 border-blue-200' : 'bg-white'}`}>
                <div className="flex items-center gap-3">
                    {oldConnected ? (
                       <img src={currentUser.avatar} className="w-10 h-10 rounded-full" alt="User" />
                    ) : (
                       <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-400"><i className="fas fa-user"></i></div>
                    )}
                    <div>
                        <div className="font-bold text-sm text-gray-900">{oldConnected ? currentUser.name : (migrationMode === 'PROFILE_TO_PAGE' ? 'Personal Profile' : 'Source Page')}</div>
                        <div className="text-xs text-gray-500">Source</div>
                    </div>
                </div>
                {!oldConnected ? (
                    <Button 
                        onClick={() => mode === 'demo' ? handleConnectOldAccount() : prepareConnection('source')} 
                        className="text-xs h-8"
                    >
                        Connect
                    </Button>
                ) : (
                    <Button variant="ghost" className="text-red-500 text-xs hover:bg-red-50 h-8" onClick={() => handleDisconnect('source')}>
                      Disconnect
                    </Button>
                )}
            </div>
        </div>

        <div className="flex justify-center mb-4"><i className="fas fa-arrow-down text-gray-300"></i></div>

        {/* Destination Card */}
        <div className="mb-8">
            <div className={`p-4 border rounded-lg flex items-center justify-between ${newConnected ? 'bg-blue-50 border-blue-200' : 'bg-white'}`}>
                <div className="flex items-center gap-3">
                    {newConnected ? (
                       <img src={destinationUser.avatar} className="w-10 h-10 rounded-full" alt="User" />
                    ) : (
                       <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-400"><i className="fas fa-flag"></i></div>
                    )}
                    <div>
                        <div className="font-bold text-sm text-gray-900">{newConnected ? destinationUser.name : 'Public Page'}</div>
                        <div className="text-xs text-gray-500">Destination</div>
                    </div>
                </div>
                {!newConnected ? (
                    <Button 
                        disabled={!oldConnected && mode === 'live'}
                        onClick={() => mode === 'demo' ? handleConnectNewAccount() : prepareConnection('destination')} 
                        className="text-xs h-8"
                    >
                        Connect
                    </Button>
                ) : (
                    <Button variant="ghost" className="text-red-500 text-xs hover:bg-red-50 h-8" onClick={() => handleDisconnect('destination')}>
                      Disconnect
                    </Button>
                )}
            </div>
        </div>

        <Button fullWidth disabled={!oldConnected || !newConnected} onClick={() => setStep(AppStep.FILTER_INPUT)}>Continue</Button>
      </div>
    );
  };

  const renderFilterInput = () => (
    <div className="max-w-2xl mx-auto mt-16 px-4">
      <div className="text-center mb-10">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">What should we move?</h2>
        <p className="text-gray-600">AI Agent will scan <strong>{sourcePosts.length}</strong> posts from {currentUser.name}.</p>
      </div>
      
      <div className="bg-white p-6 rounded-2xl shadow-xl border border-gray-200">
          <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Topic / Keywords</label>
          <div className="relative flex items-center gap-2 mb-6 border-b pb-6 border-gray-100">
            <input 
              type="text" 
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="e.g. Concerts, Food, Cats..."
              className="flex-1 p-2 outline-none text-lg text-gray-700 bg-transparent placeholder-gray-300"
              onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
            />
            <button onClick={handleMicClick} className={`p-2 rounded-xl transition-colors ${isListening ? 'text-red-500 animate-pulse' : 'text-gray-400 hover:text-gray-600'}`}><i className="fas fa-microphone"></i></button>
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">From Date (Optional)</label>
                <input 
                  type="date" 
                  className="w-full p-3 bg-gray-50 rounded-lg border border-gray-200 focus:border-facebook-blue outline-none text-sm text-gray-700 transition-colors focus:ring-1 focus:ring-facebook-blue"
                  value={dateRange.start}
                  onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
                />
             </div>
             <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">To Date (Optional)</label>
                <input 
                  type="date" 
                  className="w-full p-3 bg-gray-50 rounded-lg border border-gray-200 focus:border-facebook-blue outline-none text-sm text-gray-700 transition-colors focus:ring-1 focus:ring-facebook-blue"
                  value={dateRange.end}
                  onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
                />
             </div>
          </div>
      </div>
      
      <div className="mt-8 flex justify-center"><Button onClick={handleAnalyze} isLoading={isFiltering} disabled={!filterText || isFiltering} className="px-12 py-4 text-lg rounded-full shadow-lg">Find Posts</Button></div>
    </div>
  );

  const renderReview = () => (
    <div className="max-w-5xl mx-auto mt-8 px-4 mb-20">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-bold">Found {filteredPosts.length} posts for "{filterText}"</h2>
        <div className="flex gap-4 items-center">
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={selectedPostIds.size === filteredPosts.length && filteredPosts.length > 0} onChange={handleSelectAll} /> Select All</label>
            <Button onClick={handleProceedToPreview} disabled={selectedPostIds.size === 0}>Preview & Edit</Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {filteredPosts.map(post => (
            <PostCard key={post.id} post={post} isSelected={selectedPostIds.has(post.id)} onToggle={handleToggleSelect} />
        ))}
      </div>
    </div>
  );

  const renderEditPreview = () => (
    <div className="max-w-3xl mx-auto mt-8 px-4 mb-24">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-bold">Preview</h2>
        <Button variant="secondary" onClick={() => setStep(AppStep.REVIEW)}>Back</Button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-gray-800">Append Metadata</div>
            <div className="text-xs text-gray-600">Add original date and like count to the bottom of each post.</div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" value="" className="sr-only peer" checked={includeMetadata} onChange={(e) => handleToggleMetadata(e.target.checked)} />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-facebook-blue"></div>
          </label>
      </div>

      <div className="space-y-6">
        {editablePosts.map(post => (
          <div key={post.id} className="bg-white rounded-xl shadow p-4 border">
            <div className="flex gap-3 mb-3"><img src={destinationUser.avatar} className="w-10 h-10 rounded-full" alt=""/><div className="font-bold">{destinationUser.name}</div></div>
            <textarea className="w-full p-2 border rounded mb-2 text-sm font-sans" rows={6} value={post.content} onChange={(e) => handleUpdatePost(post.id, 'content', e.target.value)} />
            {post.imageUrl && (
               <div className="relative group">
                 <img src={post.imageUrl} className="w-full rounded" alt=""/>
                 <button onClick={() => handleUpdatePost(post.id, 'imageUrl', undefined)} className="absolute top-2 right-2 bg-red-600 text-white p-1 rounded text-xs opacity-0 group-hover:opacity-100">Remove</button>
               </div>
            )}
          </div>
        ))}
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 flex justify-center">
         <Button onClick={handleStartMigration} icon={<i className="fas fa-rocket"></i>}>Start Migration</Button>
      </div>
    </div>
  );

  const renderMigrating = () => (
    <div className="fixed inset-0 bg-black/50 z-50 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[80vh]">
        <div className="p-6 border-b bg-gray-50"><h2 className="font-bold">Migrating... {Math.round(migrationProgress)}%</h2></div>
        <div ref={logContainerRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50">
          {migrationLog.map(item => (
            <div key={item.postId} className="flex items-center gap-3 p-3 bg-white rounded border text-sm">
                <span className="w-6 text-center">{item.status === 'migrating' ? <i className="fas fa-spinner fa-spin text-blue-500"></i> : item.status === 'success' ? <i className="fas fa-check text-green-500"></i> : item.status === 'error' ? <i className="fas fa-times text-red-500"></i> : <i className="fas fa-clock text-gray-300"></i>}</span>
                <span className="truncate flex-1">{item.contentPreview}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderCompleted = () => (
    <div className="max-w-md mx-auto mt-20 p-8 bg-white rounded-xl shadow text-center">
      <i className="fas fa-check-circle text-5xl text-green-500 mb-4"></i>
      <h2 className="text-2xl font-bold mb-2">Done!</h2>
      <p className="text-gray-600 mb-6">Migrated {editablePosts.length} posts.</p>
      <div className="space-y-3">
        <Button onClick={resetApp} fullWidth>Migrate More Posts</Button>
        <Button onClick={goToHome} variant="secondary" fullWidth>Back to Home</Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen pb-10 bg-facebook-bg">
      {step !== AppStep.MIGRATING && (
        <header className="bg-white border-b h-16 flex items-center justify-between px-4 sticky top-0 z-40">
            <div className="flex items-center gap-2 font-bold text-facebook-blue cursor-pointer" onClick={() => setStep(AppStep.LOGIN)}><i className="fas fa-exchange-alt"></i> SocialMigrate AI</div>
        </header>
      )}
      <main>
        {step === AppStep.LOGIN && renderLogin()}
        {step === AppStep.FILTER_INPUT && renderFilterInput()}
        {step === AppStep.REVIEW && renderReview()}
        {step === AppStep.EDIT_PREVIEW && renderEditPreview()}
        {step === AppStep.MIGRATING && renderMigrating()}
        {step === AppStep.COMPLETED && renderCompleted()}
      </main>
    </div>
  );
};

export default App;