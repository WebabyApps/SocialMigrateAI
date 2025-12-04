import React, { useState, useEffect, useRef } from 'react';
import { AppStep, Post, UserProfile } from './types';
import { Button } from './components/Button';
import { PostCard } from './components/PostCard';
import { MOCK_POSTS, MOCK_USER_NEW, MOCK_USER_OLD } from './services/mockData';
import { filterPostsWithGemini } from './services/geminiService';
import { fetchFacebookPosts, fetchFacebookProfile } from './services/facebookService';

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.LOGIN);
  
  // Connection State
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [accessToken, setAccessToken] = useState('');
  const [isLoadingAuth, setIsLoadingAuth] = useState(false);
  const [oldConnected, setOldConnected] = useState(false);
  const [newConnected, setNewConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data State
  const [currentUser, setCurrentUser] = useState<UserProfile>(MOCK_USER_OLD);
  const [sourcePosts, setSourcePosts] = useState<Post[]>(MOCK_POSTS);
  
  // App Logic State
  const [filterText, setFilterText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isFiltering, setIsFiltering] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState(0);
  
  const [filteredPosts, setFilteredPosts] = useState<Post[]>([]);
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set());

  // Refs for Speech Recognition
  const recognitionRef = useRef<any>(null);

  // Initialize Speech Recognition
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

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech error", event);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  // Handlers
  const handleMicClick = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setIsListening(true);
      recognitionRef.current?.start();
    }
  };

  const handleConnectOldAccount = async () => {
    if (oldConnected) {
      setOldConnected(false);
      setCurrentUser(MOCK_USER_OLD);
      setSourcePosts(MOCK_POSTS);
      return;
    }

    if (mode === 'live') {
      if (!accessToken) {
        setError("Please enter a valid Facebook Graph API User Token.");
        return;
      }
      setIsLoadingAuth(true);
      setError(null);
      try {
        // Fetch Real Data
        const profile = await fetchFacebookProfile(accessToken);
        const posts = await fetchFacebookPosts(accessToken);
        
        setCurrentUser(profile);
        setSourcePosts(posts);
        setOldConnected(true);
      } catch (err: any) {
        console.error(err);
        setError(err.message || "Failed to connect to Facebook. Check your token.");
      } finally {
        setIsLoadingAuth(false);
      }
    } else {
      // Demo Mode
      setTimeout(() => {
        setOldConnected(true);
        setSourcePosts(MOCK_POSTS);
        setCurrentUser(MOCK_USER_OLD);
      }, 500);
    }
  };

  const handleAnalyze = async () => {
    if (!filterText.trim()) return;
    setIsFiltering(true);
    
    // Call Gemini Service with the CURRENT source posts (Real or Mock)
    const matchingIds = await filterPostsWithGemini(sourcePosts, filterText);
    
    const relevant = sourcePosts.filter(p => matchingIds.includes(p.id));
    setFilteredPosts(relevant);
    
    // Auto select all by default
    setSelectedPostIds(new Set(relevant.map(p => p.id)));
    
    setIsFiltering(false);
    setStep(AppStep.REVIEW);
  };

  const handleToggleSelect = (id: string) => {
    const newSet = new Set(selectedPostIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedPostIds(newSet);
  };

  const handleSelectAll = () => {
    if (selectedPostIds.size === filteredPosts.length) {
      setSelectedPostIds(new Set());
    } else {
      setSelectedPostIds(new Set(filteredPosts.map(p => p.id)));
    }
  };

  const handleStartMigration = () => {
    setStep(AppStep.MIGRATING);
    setIsMigrating(true);
    setMigrationProgress(0);

    const total = selectedPostIds.size;
    let completed = 0;
    
    // In Live Mode, this would trigger the write API. 
    // Since we don't have write permissions in this demo, we simulate the latency.
    const interval = setInterval(() => {
      completed += 1;
      const pct = Math.min((completed / total) * 100, 100);
      setMigrationProgress(pct);

      if (completed >= total) {
        clearInterval(interval);
        setTimeout(() => {
          setIsMigrating(false);
          setStep(AppStep.COMPLETED);
        }, 800);
      }
    }, 800); 
  };

  const resetApp = () => {
    setStep(AppStep.FILTER_INPUT);
    setFilterText('');
    setFilteredPosts([]);
    setSelectedPostIds(new Set());
    setMigrationProgress(0);
  };

  // --- RENDER STEPS ---

  const renderLogin = () => (
    <div className="max-w-md mx-auto mt-10 p-8 bg-white rounded-xl shadow-lg border border-gray-100">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-facebook-blue">SocialMigrate AI</h1>
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button 
            onClick={() => { setMode('demo'); setOldConnected(false); setError(null); }}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${mode === 'demo' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Demo
          </button>
          <button 
            onClick={() => { setMode('live'); setOldConnected(false); setError(null); }}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${mode === 'live' ? 'bg-white shadow text-facebook-blue' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Live Mode
          </button>
        </div>
      </div>
      
      <p className="text-center text-gray-500 mb-6 text-sm">
        {mode === 'demo' 
          ? "Try the app with sample data." 
          : "Connect to the Graph API to filter your real posts."}
      </p>

      {/* Live Mode Token Input */}
      {mode === 'live' && !oldConnected && (
        <div className="mb-6 animate-fade-in">
          <label className="block text-xs font-semibold text-gray-700 mb-2">Facebook User Access Token</label>
          <input 
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="EAA..."
            className="w-full p-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-facebook-blue focus:border-transparent outline-none"
          />
          <p className="text-[10px] text-gray-400 mt-1">
            Get a token from the <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="text-facebook-blue hover:underline">Graph API Explorer</a> with `user_posts` permission.
          </p>
        </div>
      )}
      
      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <i className="fas fa-exclamation-circle text-red-500 mt-0.5"></i>
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        {/* Old Account */}
        <div className={`p-4 border rounded-lg flex items-center justify-between transition-colors ${oldConnected ? 'bg-blue-50 border-blue-200' : 'bg-gray-50'}`}>
          <div className="flex items-center gap-3">
            {oldConnected ? (
               <img src={currentUser.avatar} alt="Profile" className="w-10 h-10 rounded-full border border-gray-200" />
            ) : (
               <i className={`fab fa-facebook text-3xl text-gray-400`}></i>
            )}
            <div className="overflow-hidden">
              <div className="font-medium text-gray-900 truncate max-w-[150px]">{oldConnected ? currentUser.name : 'Old Account'}</div>
              <div className="text-xs text-gray-500">{oldConnected ? `${sourcePosts.length} posts loaded` : 'Source'}</div>
            </div>
          </div>
          <Button 
            variant={oldConnected ? "secondary" : "primary"} 
            onClick={handleConnectOldAccount}
            isLoading={isLoadingAuth}
            className="text-xs shrink-0"
          >
            {oldConnected ? 'Disconnect' : mode === 'live' ? 'Fetch Data' : 'Connect Demo'}
          </Button>
        </div>

        <div className="flex justify-center">
          <i className="fas fa-arrow-down text-gray-300"></i>
        </div>

        {/* New Account */}
        <div className="p-4 border rounded-lg flex items-center justify-between bg-gray-50">
          <div className="flex items-center gap-3">
             <i className={`fab fa-facebook text-3xl ${newConnected ? 'text-facebook-blue' : 'text-gray-400'}`}></i>
            <div>
              <div className="font-medium text-gray-900">New Account</div>
              <div className="text-xs text-gray-500">{newConnected ? MOCK_USER_NEW.name : 'Destination'}</div>
            </div>
          </div>
          <Button 
            variant={newConnected ? "secondary" : "primary"} 
            onClick={() => setNewConnected(!newConnected)}
            className="text-xs"
          >
            {newConnected ? 'Disconnect' : 'Connect'}
          </Button>
        </div>
      </div>

      <div className="mt-8">
        <Button 
          fullWidth 
          disabled={!oldConnected || !newConnected}
          onClick={() => setStep(AppStep.FILTER_INPUT)}
        >
          Continue
        </Button>
      </div>
    </div>
  );

  const renderFilterInput = () => (
    <div className="max-w-2xl mx-auto mt-16 px-4">
      <div className="text-center mb-10">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">What should we move?</h2>
        <p className="text-gray-600">
          AI Agent will scan <strong>{sourcePosts.length}</strong> posts.
          <br/>Try "Concerts from 2023" or "Photos of my cat".
        </p>
      </div>

      <div className="relative bg-white p-2 rounded-2xl shadow-xl border border-gray-200 flex items-center gap-2">
        <div className="pl-4 text-gray-400">
          <i className="fas fa-sparkles"></i>
        </div>
        <input 
          type="text" 
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Describe the posts to filter..."
          className="flex-1 p-4 outline-none text-lg text-gray-700 placeholder-gray-400 bg-transparent"
          onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
        />
        <button 
          onClick={handleMicClick}
          className={`p-4 rounded-xl transition-all duration-200 ${isListening ? 'bg-red-50 text-red-500 animate-pulse' : 'hover:bg-gray-100 text-gray-500'}`}
          title="Speak"
        >
          <i className={`fas fa-microphone ${isListening ? 'fa-beat' : ''}`}></i>
        </button>
      </div>

      <div className="mt-8 flex justify-center">
        <Button 
          onClick={handleAnalyze} 
          isLoading={isFiltering}
          disabled={!filterText || isFiltering}
          className="px-12 py-4 text-lg rounded-full shadow-lg shadow-blue-500/30"
        >
          Find Posts
        </Button>
      </div>
    </div>
  );

  const renderReview = () => (
    <div className="max-w-5xl mx-auto mt-8 px-4 mb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Found {filteredPosts.length} posts</h2>
          <p className="text-gray-500 text-sm">Topic: <span className="font-medium text-facebook-blue">"{filterText}"</span></p>
        </div>
        
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input 
              type="checkbox" 
              checked={selectedPostIds.size === filteredPosts.length && filteredPosts.length > 0}
              onChange={handleSelectAll}
              className="rounded text-facebook-blue focus:ring-facebook-blue"
            />
            Select All
          </label>
          <Button 
            onClick={handleStartMigration}
            disabled={selectedPostIds.size === 0}
            icon={<i className="fas fa-rocket"></i>}
          >
            Migrate {selectedPostIds.size} Posts
          </Button>
        </div>
      </div>

      {filteredPosts.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
          <div className="text-6xl mb-4">👻</div>
          <h3 className="text-xl font-medium text-gray-900">No posts found</h3>
          <p className="text-gray-500 mb-6">We couldn't find any posts matching your description.</p>
          <Button variant="secondary" onClick={() => setStep(AppStep.FILTER_INPUT)}>Try a different topic</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPosts.map(post => (
            <PostCard 
              key={post.id} 
              post={post} 
              isSelected={selectedPostIds.has(post.id)}
              onToggle={handleToggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );

  const renderMigrating = () => (
    <div className="fixed inset-0 bg-white z-50 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-md text-center">
        <div className="mb-8 relative">
          <div className="w-24 h-24 bg-blue-50 rounded-full mx-auto flex items-center justify-center animate-pulse">
            <i className="fas fa-sync fa-spin text-4xl text-facebook-blue"></i>
          </div>
        </div>
        
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Migrating Posts...</h2>
        <p className="text-gray-500 mb-8">Moving memories to {MOCK_USER_NEW.handle}</p>

        <div className="w-full bg-gray-100 rounded-full h-4 overflow-hidden mb-4">
          <div 
            className="bg-facebook-blue h-full transition-all duration-300 ease-out"
            style={{ width: `${migrationProgress}%` }}
          ></div>
        </div>
        <p className="text-sm text-gray-400 font-mono">{Math.round(migrationProgress)}% Complete</p>
      </div>
    </div>
  );

  const renderCompleted = () => (
    <div className="max-w-md mx-auto mt-20 p-8 bg-white rounded-xl shadow-lg border border-gray-100 text-center">
      <div className="w-20 h-20 bg-green-100 rounded-full mx-auto flex items-center justify-center mb-6">
        <i className="fas fa-check text-3xl text-green-600"></i>
      </div>
      
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Migration Complete!</h2>
      <p className="text-gray-600 mb-8">
        Processed <span className="font-bold">{selectedPostIds.size}</span> posts.
        {mode === 'live' && (
          <span className="block mt-2 text-xs text-amber-600 bg-amber-50 p-2 rounded">
            Note: Actual cross-posting requires Facebook "Pages API" write permissions. 
            This demo simulates the transfer process.
          </span>
        )}
      </p>

      <div className="space-y-3">
        <Button fullWidth onClick={resetApp}>Start New Migration</Button>
        <Button fullWidth variant="ghost" onClick={() => setStep(AppStep.LOGIN)}>Sign Out</Button>
      </div>
    </div>
  );

  // --- MAIN RENDER ---

  return (
    <div className="min-h-screen pb-10 bg-facebook-bg">
      {/* Header */}
      {step !== AppStep.MIGRATING && (
        <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => step !== AppStep.LOGIN && setStep(AppStep.FILTER_INPUT)}>
              <div className="w-8 h-8 bg-facebook-blue rounded-full flex items-center justify-center text-white font-bold">
                <i className="fas fa-exchange-alt text-xs"></i>
              </div>
              <span className="font-bold text-facebook-blue tracking-tight">SocialMigrate AI</span>
              {mode === 'live' && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">Live</span>}
            </div>
            {step !== AppStep.LOGIN && (
               <div className="flex items-center gap-3">
                 <img src={currentUser.avatar} className="w-8 h-8 rounded-full border border-gray-200 opacity-70 grayscale" alt="Old" />
                 <i className="fas fa-arrow-right text-gray-300 text-xs"></i>
                 <img src={MOCK_USER_NEW.avatar} className="w-8 h-8 rounded-full border border-gray-200" alt="New" />
               </div>
            )}
          </div>
        </header>
      )}

      <main>
        {step === AppStep.LOGIN && renderLogin()}
        {step === AppStep.FILTER_INPUT && renderFilterInput()}
        {step === AppStep.REVIEW && renderReview()}
        {step === AppStep.MIGRATING && renderMigrating()}
        {step === AppStep.COMPLETED && renderCompleted()}
      </main>
    </div>
  );
};

export default App;