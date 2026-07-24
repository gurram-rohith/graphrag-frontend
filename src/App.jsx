import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { 
  Terminal, 
  FolderGit, 
  Settings, 
  Send, 
  Cpu, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Database,
  Server,
  Copy,
  Check
} from 'lucide-react';
import { 
  ingestRepository, 
  getIngestionStatus, 
  checkHealth 
} from './services/apiClient';

function App() {
  const [repoUrl, setRepoUrl] = useState('');
  const [apiOnline, setApiOnline] = useState('checking');

  // --- LOCALSTORAGE STATE IMPLEMENTATION (Preserved) ---
  
  const [ownerId, setOwnerId] = useState(() => {
    const saved = localStorage.getItem('graphrag_owner_id');
    if (saved) return saved;
    const newId = crypto.randomUUID();
    localStorage.setItem('graphrag_owner_id', newId);
    return newId;
  });

  const [displayName, setDisplayName] = useState(() => {
    return localStorage.getItem('graphrag_display_name') || 'Rohith Gurram';
  });

  const [projectId, setProjectId] = useState(() => {
    return localStorage.getItem('graphrag_project_id') || 'Project_A';
  });

  const [chatHistory, setChatHistory] = useState(() => {
    const savedChat = localStorage.getItem('graphrag_chat_history');
    if (savedChat) {
      const parsed = JSON.parse(savedChat);
      return parsed.map(msg => ({ ...msg, timestamp: new Date(msg.timestamp) }));
    }
    return [
      {
        role: 'assistant',
        content: "Welcome to the GraphRAG Code Assistant terminal.\n\nTo begin:\n1. Input a GitHub repository URL on the sidebar.\n2. Ingest the repository structure into Neo4j.\n3. Ask questions about dependencies, function calls, class hierarchies, and structures in the panel below.",
        timestamp: new Date()
      }
    ];
  });

  useEffect(() => {
    localStorage.setItem('graphrag_display_name', displayName);
  }, [displayName]);

  useEffect(() => {
    localStorage.setItem('graphrag_project_id', projectId);
  }, [projectId]);

  useEffect(() => {
    // Only save healthy history to prevent corrupted reloads
    const robustHistory = chatHistory.filter(msg => 
      msg.content && !msg.content.includes("Connection Error")
    );
    if (robustHistory.length > 0) {
      localStorage.setItem('graphrag_chat_history', JSON.stringify(robustHistory));
    }
  }, [chatHistory]);

  // --- END LOCALSTORAGE IMPLEMENTATION ---

  const [ingestion, setIngestion] = useState({
    status: 'idle',
    url: null,
    processed_files: 0,
    errors: 0,
    error_message: null
  });

  const [question, setQuestion] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  
  // Kept solely for copying markdown code blocks
  const [copiedIndex, setCopiedIndex] = useState(null);

  const messagesEndRef = useRef(null);
  const hasNotified = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory, chatLoading]);

  // Check backend health
  useEffect(() => {
    const checkBackend = async () => {
      try {
        const data = await checkHealth();
        setApiOnline(data.status === 'online');
      } catch (e) {
        setApiOnline(false);
      }
    };
    checkBackend();
    const interval = setInterval(checkBackend, 10000);
    return () => clearInterval(interval);
  }, []);

  // Poll Ingestion Status
  useEffect(() => {
    let interval;
    if (ingestion.status === 'processing') {
      hasNotified.current = false;
      interval = setInterval(async () => {
        try {
          const data = await getIngestionStatus();
          setIngestion(data);
          
          if ((data.status === 'completed' || data.status === 'failed') && !hasNotified.current) {
            hasNotified.current = true;
            clearInterval(interval); 
            
            setChatHistory(prev => [
              ...prev,
              {
                role: 'assistant',
                content: data.status === 'completed' 
                  ? `### System Building Finished Successfully\nProcessed **${data.processed_files}** files with **${data.errors}** errors.\nThe knowledge graph is now fully searchable.`
                  : `### System Building Failed\nError: \`${data.error_message}\``,
                timestamp: new Date()
              }
            ]);
          }
        } catch (e) {
          console.error("Error polling ingestion status:", e);
          clearInterval(interval);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [ingestion.status]);

  // Handle ingestion request
  // Handle ingestion request
  const handleIngestSubmit = async (e) => {
    e.preventDefault();
    if (!repoUrl.trim() || !projectId.trim()) return; 
    try {
      setIngestion({
        status: 'processing',
        url: repoUrl,
        processed_files: 0,
        errors: 0,
        error_message: null
      });
      
      setChatHistory(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `### Initiated Ingestion Pipeline\nCloning repository: \`${repoUrl}\` into project scope \`${projectId}\`...\nChecking repository size...`,
          timestamp: new Date()
        }
      ]);

      await ingestRepository(repoUrl, ownerId, projectId);
    } catch (err) {
      // 1. Extract the error message sent from the Python backend
      const errMsg = err.response?.data?.detail || err.message;
      
      // 2. Check if the error message is about our 200-file size limit
      const isSizeError = errMsg.toLowerCase().includes('too large') || errMsg.toLowerCase().includes('limit is 200');

      setIngestion({
        status: 'failed',
        url: repoUrl,
        processed_files: 0,
        errors: 0,
        error_message: errMsg
      });

      // 3. Display a nice, clear warning to the user in the chat
      setChatHistory(prev => [
        ...prev,
        {
          role: 'assistant',
          content: isSizeError 
            ? `### ⚠️ Repository Exceeds Size Limit\nThis repository is too large to be processed.\n\n**Details:** ${errMsg}\n\n*Please try a smaller repository (under 200 files).*`
            : `### Ingestion Error\nFailed to start pipeline: \`${errMsg}\``,
          timestamp: new Date()
        }
      ]);
    }
  };

  // Streaming Question Submit
  const handleQuestionSubmit = async (e) => {
    e.preventDefault();
    if (!question.trim() || chatLoading) return;

    const userQuestion = question;
    setQuestion('');
    
    setChatHistory(prev => [
      ...prev,
      { role: 'user', content: userQuestion, timestamp: new Date() },
      { role: 'assistant', content: "", timestamp: new Date() }
    ]);
    
    setChatLoading(true);

    try {
      const API_BASE_URL = "https://graphrag-backend-h852.onrender.com";

      const response = await fetch(`${API_BASE_URL}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userQuestion,
          owner_id: ownerId,
          project_id: projectId
        })
      });

      if (!response.body) throw new Error("No response body returned from server.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        
        if (value) {
          const chunkString = decoder.decode(value, { stream: true });
          const lines = chunkString.split('\n').filter(line => line.trim() !== '');
          
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              
              setChatHistory(prev => {
                const newHistory = [...prev];
                const lastMsg = { ...newHistory[newHistory.length - 1] };
                
                // Ignoring metadata, mapping only raw chunks
                if (data.chunk) {
                  lastMsg.content += data.chunk; 
                } else if (data.response) {
                  lastMsg.content = data.response; 
                }
                
                newHistory[newHistory.length - 1] = lastMsg;
                return newHistory;
              });
            } catch (err) {
              console.error("Error parsing stream line:", err, line);
            }
          }
        }
      }
    } catch (err) {
      console.error("Fetch error:", err);
      setChatHistory(prev => {
        const newHistory = [...prev];
        const lastMsg = { ...newHistory[newHistory.length - 1] };
        const existingContent = lastMsg.content || "";
        lastMsg.content = `${existingContent}\n\n### [Stream Interrupted]\n⚠️ *Network connection lost. Partial response preserved.*`;
        newHistory[newHistory.length - 1] = lastMsg;
        return newHistory;
      });
    } finally {
      setChatLoading(false);
    }
  };

  const copyToClipboard = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0c0d12] text-slate-300">
      
      {/* Sidebar Panel */}
      <aside className="w-80 flex flex-col bg-[#0f111a] border-r border-[#1e2235] select-none shrink-0">
        <div className="p-4 border-b border-[#1e2235] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Cpu className="w-5 h-5 text-indigo-400" />
            <span className="font-semibold text-white tracking-wider text-sm">GRAPHRAG IDE</span>
          </div>
          <div className="flex items-center space-x-1.5" title={apiOnline === 'checking' ? "Checking connection..." : apiOnline ? "Backend Connected" : "Backend Offline"}>
            <div className={`w-2.5 h-2.5 rounded-full ${apiOnline === 'checking' ? 'bg-amber-500 animate-pulse' : apiOnline ? 'bg-emerald-500 glow-green' : 'bg-rose-500'}`} />
            <span className="text-[10px] uppercase font-mono tracking-wider font-semibold text-slate-500">
              {apiOnline === 'checking' ? 'checking' : apiOnline ? 'online' : 'offline'}
            </span>
          </div>
        </div>

        {/* Configurations Form */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div className="space-y-3">
            <label className="flex items-center text-xs font-mono font-bold tracking-wider text-slate-400 uppercase">
              <Settings className="w-3.5 h-3.5 mr-1 text-slate-500" /> Developer Config
            </label>
            <div className="bg-[#07080d] p-3 rounded-lg border border-[#1e2235] space-y-3">
              <div>
                <label className="block text-[10px] font-mono text-slate-500 mb-1">OWNER ID</label>
                <input 
                  type="text" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
                  className="w-full bg-[#0c0d12] border border-[#1e2235] rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono text-slate-500 mb-1">PROJECT ID</label>
                <input 
                  type="text" value={projectId} onChange={(e) => setProjectId(e.target.value)}
                  className="w-full bg-[#0c0d12] border border-[#1e2235] rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono text-slate-500 mb-1">BACKEND URL</label>
                <div className="flex items-center space-x-1 bg-[#0c0d12] border border-[#1e2235] rounded px-2 py-1 text-xs font-mono text-slate-400">
                  <Server className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
                  <span className="truncate">https://graphrag-backend-h852.onrender.com</span>
                </div>
              </div>
            </div>
          </div>

          {/* Ingestion Panel */}
          <form onSubmit={handleIngestSubmit} className="space-y-3">
            <label className="flex items-center text-xs font-mono font-bold tracking-wider text-slate-400 uppercase">
              <FolderGit className="w-3.5 h-3.5 mr-1 text-slate-500" /> Source Repository
            </label>
            <div className="bg-[#07080d] p-3 rounded-lg border border-[#1e2235] space-y-3">
              <div>
                <label className="block text-[10px] font-mono text-slate-500 mb-1">GITHUB REPO URL</label>
                <input 
                  type="url" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} required placeholder="https://github.com/..."
                  className="w-full bg-[#0c0d12] border border-[#1e2235] rounded px-2.5 py-1.5 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
              <button 
                type="submit" disabled={ingestion.status === 'processing'}
                className={`w-full flex items-center justify-center space-x-1.5 py-2 px-3 rounded text-xs font-semibold text-white transition-all ${ingestion.status === 'processing' ? 'bg-indigo-900 cursor-not-allowed text-indigo-400' : 'bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98]'}`}
              >
                {ingestion.status === 'processing' ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /><span>System Building...</span></>
                ) : (
                  <><Database className="w-3.5 h-3.5" /><span>Ingest Repository</span></>
                )}
              </button>
            </div>
          </form>

          {/* Real-time Status Log */}
          <div className="space-y-2">
            <div className="text-[10px] font-mono font-bold tracking-wider text-slate-500 uppercase">Ingestion Console</div>
            <div className="bg-[#07080d] border border-[#1e2235] rounded-lg p-3 min-h-24 flex flex-col justify-between font-mono text-[11px] leading-relaxed">
              {ingestion.status === 'idle' && (
                <div className="text-slate-600"><span className="text-slate-500 font-bold">$</span> await run_pipeline()<div className="mt-1 text-slate-600 italic">No active pipelines.</div></div>
              )}
              {ingestion.status === 'processing' && (
                <div className="space-y-1">
                  <div className="text-amber-500 animate-pulse flex items-center"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5 animate-ping" /><span>SYSTEM BUILDING ACTIVE</span></div>
                  <div className="text-slate-500 truncate text-[10px]">{ingestion.url}</div>
                  <div className="text-slate-400 mt-2">Cloning/parsing repository AST nodes...</div>
                </div>
              )}
              {ingestion.status === 'completed' && (
                <div className="space-y-1 text-emerald-400">
                  <div className="flex items-center"><CheckCircle2 className="w-3.5 h-3.5 mr-1" /><span>PIPELINE SUCCESS</span></div>
                  <div className="text-slate-400 text-[10px] truncate">{ingestion.url}</div>
                  <div className="mt-2 text-slate-400 space-y-0.5 text-[10px]"><div>Parsed: {ingestion.processed_files} files</div><div>Errors: {ingestion.errors}</div></div>
                </div>
              )}
              {ingestion.status === 'failed' && (
                <div className="space-y-1 text-rose-500">
                  <div className="flex items-center"><AlertCircle className="w-3.5 h-3.5 mr-1" /><span>PIPELINE ERROR</span></div>
                  <div className="text-slate-400 text-[10px] truncate">{ingestion.url}</div>
                  <div className="mt-1 text-rose-400 text-[10px] bg-rose-950/30 p-1.5 rounded border border-rose-900/50 break-words max-h-24 overflow-y-auto">{ingestion.error_message}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Single-Pane Terminal Chat */}
      <main className="flex-1 flex flex-col bg-[#0c0d12]">
        <div className="h-12 border-b border-[#1e2235] bg-[#0f111a] flex items-center px-4 justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <div className="flex space-x-1.5 mr-2">
              <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
              <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
              <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
            </div>
            <Terminal className="w-4 h-4 text-slate-500" />
            <span className="font-mono text-xs text-slate-400">bash - graphrag@assistant:~</span>
          </div>
          <div className="text-xs font-mono text-slate-500 flex items-center">
            <span className="bg-indigo-950/40 text-indigo-400 border border-indigo-900/50 px-2 py-0.5 rounded text-[10px] font-bold">LLAMA-3.1-70B</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
          {chatHistory.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-4xl w-full rounded-lg border font-mono text-sm leading-relaxed ${msg.role === 'user' ? 'bg-indigo-950/20 border-indigo-800/40 text-indigo-200' : 'bg-[#07080d] border-[#1e2235]'}`}>
                
                {/* Message Header */}
                <div className={`px-4 py-2 border-b flex items-center justify-between text-xs ${msg.role === 'user' ? 'border-indigo-800/30 text-indigo-400 bg-indigo-950/30' : 'border-[#1e2235] text-slate-500 bg-[#0f111a]/40'}`}>
                  <div className="flex items-center space-x-1.5">
                    <span className="font-bold">{msg.role === 'user' ? 'graphrag@user' : 'graphrag@assistant'}</span>
                    <span className="text-[10px] text-slate-600">•</span>
                    <span>{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  </div>
                </div>

                {/* Message Content */}
                <div className="p-4 overflow-x-auto text-slate-300">
                  {msg.role === 'user' ? (
                    <div className="flex items-start"><span className="text-indigo-400 font-bold mr-2 select-none">$</span><span className="whitespace-pre-wrap">{msg.content}</span></div>
                  ) : (
                    <div className="prose prose-invert max-w-none prose-pre:bg-[#0c0d12] prose-pre:border prose-pre:border-[#1e2235] prose-code:text-indigo-300">
                      <ReactMarkdown
                        components={{
                          h1: ({node, ...props}) => <h1 className="text-base font-bold text-white mb-2" {...props} />,
                          h2: ({node, ...props}) => <h2 className="text-sm font-bold text-white mb-2 mt-4 border-b border-[#1e2235] pb-1" {...props} />,
                          h3: ({node, ...props}) => <h3 className="text-xs font-bold text-indigo-400 mb-1 mt-3" {...props} />,
                          code: ({node, inline, className, children, ...props}) => {
                            const match = /language-(\w+)/.exec(className || '');
                            return !inline ? (
                              <div className="relative group my-3">
                                <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => copyToClipboard(String(children), idx)} className="p-1 rounded bg-[#0f111a] hover:bg-[#1e2235] border border-[#1e2235] text-slate-400 transition-colors">
                                    {copiedIndex === idx ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                                <pre className="bg-[#0c0d12] border border-[#1e2235] rounded p-3 text-xs overflow-x-auto leading-relaxed text-indigo-100"><code className={className} {...props}>{children}</code></pre>
                              </div>
                            ) : <code className="bg-[#0c0d12] border border-[#1e2235] rounded px-1.5 py-0.5 text-xs text-indigo-300" {...props}>{children}</code>;
                          }
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          
          {chatLoading && (
            <div className="flex items-start">
              <div className="max-w-4xl w-full rounded-lg border border-[#1e2235] bg-[#07080d] font-mono text-sm leading-relaxed">
                <div className="px-4 py-2 border-b border-[#1e2235] text-xs text-slate-500 bg-[#0f111a]/40 flex items-center justify-between">
                  <span className="font-bold">graphrag@assistant</span>
                  <div className="flex items-center space-x-1 text-[10px] text-indigo-400"><RefreshCw className="w-3 h-3 animate-spin mr-1" /><span>SEARCHING GRAPH...</span></div>
                </div>
                <div className="p-4 text-slate-500 flex items-center space-x-2">
                  <span className="text-indigo-400 font-bold animate-pulse-fast mr-1">$</span>
                  <span className="animate-pulse">Synthesizing Neo4j relationships and generating answer...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Form Bar */}
        <div className="p-4 border-t border-[#1e2235] bg-[#0f111a]/50 shrink-0">
          <form onSubmit={handleQuestionSubmit} className="flex items-center space-x-3 bg-[#07080d] border border-[#1e2235] rounded-lg p-2 focus-within:border-indigo-500 transition-colors">
            <span className="font-mono text-xs text-indigo-500 font-semibold select-none pl-2 flex items-center"><span className="text-slate-500 mr-1">graphrag@assistant:~$</span></span>
            <input 
              type="text" value={question} onChange={(e) => setQuestion(e.target.value)} disabled={chatLoading}
              placeholder={ingestion.status === 'idle' ? "Please ingest a repository first..." : "Ask a question about the code structure..."}
              className="flex-1 bg-transparent text-sm font-mono text-white placeholder-slate-600 focus:outline-none py-1.5"
            />
            <button type="submit" disabled={!question.trim() || chatLoading} className={`p-2 rounded-md transition-all ${!question.trim() || chatLoading ? 'bg-slate-900 text-slate-700 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95'}`}>
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </main>

    </div>
  );
}

export default App;