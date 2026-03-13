import React, { useState, useEffect, useMemo } from 'react';
import { Users, Home, Sparkles, Building2, ArrowRight, CheckCircle2, XCircle, Image as ImageIcon, Video, ExternalLink, X, MessageCircle, Search, Filter, ArrowUpDown, Map as MapIcon } from 'lucide-react';
import { APIProvider, Map, AdvancedMarker, InfoWindow, useAdvancedMarkerRef } from '@vis.gl/react-google-maps';
import { Tenant, Landlord, MatchResult, InventoryItem } from '../types';
import { fetchTenants, fetchLandlords, fetchInventory } from '../services/dataService';
import { matchTenantWithLandlords, matchLandlordWithTenants, matchTenantWithInventory } from '../services/aiService';

// Helper to extract Google Drive image IDs and format them for direct embedding
const parseDriveLinks = (text: string) => {
  if (!text) return [];
  const links = text.split(',').map(l => l.trim()).filter(Boolean);
  return links.map(link => {
    let id = '';
    const idMatch = link.match(/id=([a-zA-Z0-9_-]+)/);
    const dMatch = link.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (idMatch) id = idMatch[1];
    else if (dMatch) id = dMatch[1];
    
    return {
      original: link,
      id,
      // Use thumbnail endpoint for Drive images, otherwise use the direct link
      imageUrl: id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1000` : link,
      previewUrl: id ? `https://drive.google.com/file/d/${id}/preview` : link
    };
  });
};

const formatWhatsAppNumber = (number: string) => {
  if (!number) return '';
  let cleaned = number.replace(/\D/g, '');
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  }
  return cleaned;
};

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'tenants' | 'landlords' | 'inventory' | 'matches' | 'map'>('tenants');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [landlords, setLandlords] = useState<Landlord[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [selectedLandlord, setSelectedLandlord] = useState<Landlord | null>(null);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [allMatches, setAllMatches] = useState<Record<string, MatchResult[]>>({});
  const [matchAllProgress, setMatchAllProgress] = useState<{ current: number, total: number } | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<{ url: string, type: 'image' | 'video' } | null>(null);
  const [openInfoWindowId, setOpenInfoWindowId] = useState<string | null>(null);
  
  // Filter and Sort States
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenantSort, setTenantSort] = useState<'budget-asc' | 'budget-desc' | 'newest'>('newest');
  
  const [landlordSearch, setLandlordSearch] = useState('');
  const [landlordSort, setLandlordSort] = useState<'rent-asc' | 'rent-desc' | 'newest'>('newest');
  
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventorySort, setInventorySort] = useState<'rent-asc' | 'rent-desc' | 'newest'>('newest');
  
  // Multi-select Filter States for Tenants
  const [selectedBudgets, setSelectedBudgets] = useState<string[]>([]);
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  
  // Manual Availability Overrides for Inventory
  const [manualAvailability, setManualAvailability] = useState<Record<string, boolean>>({});

  // Match Filter States
  const [matchScoreFilter, setMatchScoreFilter] = useState<number>(0);
  const [matchSourceFilter, setMatchSourceFilter] = useState<'All' | 'Property Listing' | 'Complete Inventory'>('All');

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        const [t, l, inv] = await Promise.all([fetchTenants(), fetchLandlords(), fetchInventory()]);
        if (isMounted) {
          setTenants(t);
          setLandlords(l);
          setInventory(inv);
          setLoading(false);
        }
      } catch (error) {
        console.error("Failed to load data", error);
        if (isMounted && loading) setLoading(false);
      }
    }
    
    loadData();
    const intervalId = setInterval(loadData, 5000); // Changed to 5s to avoid rate limiting
    
    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

  const handleMatchTenant = async (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setSelectedLandlord(null);
    setActiveTab('matches');
    
    if (allMatches[tenant.id]) {
      setMatches(allMatches[tenant.id]);
      return;
    }
    
    setMatching(true);
    
    // Filter out landlords that are marked as unavailable in inventory
    const availableLandlords = landlords.filter(l => {
      const lPhone = formatWhatsAppNumber(l.contactNumber || '');
      const matchingInventoryItem = inventory.find(inv => formatWhatsAppNumber(inv.phoneNumber || '') === lPhone);
      
      if (matchingInventoryItem) {
        const isManuallySet = manualAvailability[matchingInventoryItem.id] !== undefined;
        const isAvailable = isManuallySet 
          ? manualAvailability[matchingInventoryItem.id] 
          : (matchingInventoryItem.availability?.toLowerCase().includes('available') || true); // If matchingLandlord exists, it's usually available unless marked otherwise
        
        return isAvailable;
      }
      return true;
    });

    const availableInventory = inventory.filter(item => {
      const isManuallySet = manualAvailability[item.id] !== undefined;
      return isManuallySet 
        ? manualAvailability[item.id] 
        : item.availability?.toLowerCase().includes('available');
    });

    const [landlordResults, inventoryResults] = await Promise.all([
      matchTenantWithLandlords(tenant, availableLandlords),
      matchTenantWithInventory(tenant, availableInventory)
    ]);

    const combinedResults = [...landlordResults, ...inventoryResults].sort((a, b) => b.matchScore - a.matchScore);
    setMatches(combinedResults);
    setMatching(false);
  };

  const handleMatchLandlord = async (landlord: Landlord) => {
    setSelectedLandlord(landlord);
    setSelectedTenant(null);
    setActiveTab('matches');
    setMatching(true);
    const isFromInventory = !landlords.some(l => l.id === landlord.id);
    const source = isFromInventory ? 'Complete Inventory' : 'Property Listing';
    const results = await matchLandlordWithTenants(landlord, tenants, source);
    setMatches(results);
    setMatching(false);
  };

  const handleMatchAllTenants = async () => {
    setMatching(true);
    setMatchAllProgress({ current: 0, total: tenants.length });
    const newAllMatches: Record<string, MatchResult[]> = {};
    
    // Filter available properties once
    const availableLandlords = landlords.filter(l => {
      const lPhone = formatWhatsAppNumber(l.contactNumber || '');
      const matchingInventoryItem = inventory.find(inv => formatWhatsAppNumber(inv.phoneNumber || '') === lPhone);
      if (matchingInventoryItem) {
        const isManuallySet = manualAvailability[matchingInventoryItem.id] !== undefined;
        return isManuallySet ? manualAvailability[matchingInventoryItem.id] : (matchingInventoryItem.availability?.toLowerCase().includes('available') || true);
      }
      return true;
    });

    const availableInventory = inventory.filter(item => {
      const isManuallySet = manualAvailability[item.id] !== undefined;
      return isManuallySet ? manualAvailability[item.id] : item.availability?.toLowerCase().includes('available');
    });

    // Process in chunks to avoid rate limits and UI freezing
    const chunkSize = 3;
    for (let i = 0; i < tenants.length; i += chunkSize) {
      const chunk = tenants.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (tenant) => {
        try {
          const [landlordResults, inventoryResults] = await Promise.all([
            matchTenantWithLandlords(tenant, availableLandlords),
            matchTenantWithInventory(tenant, availableInventory)
          ]);
          newAllMatches[tenant.id] = [...landlordResults, ...inventoryResults].sort((a, b) => b.matchScore - a.matchScore);
        } catch (error) {
          console.error(`Failed to match tenant ${tenant.id}`, error);
          newAllMatches[tenant.id] = [];
        }
      }));
      setMatchAllProgress({ current: Math.min(i + chunkSize, tenants.length), total: tenants.length });
    }

    setAllMatches(newAllMatches);
    setMatching(false);
    setMatchAllProgress(null);
  };

  const toggleAvailability = (itemId: string) => {
    setManualAvailability(prev => ({
      ...prev,
      [itemId]: prev[itemId] === false ? true : false
    }));
  };

  // Get unique values for filters
  const uniqueBudgets = Array.from(new Set(tenants.map(t => t.monthlyBudget))).filter((b): b is string => !!b).sort();
  const uniqueRooms = Array.from(new Set(tenants.map(t => t.roomPreference))).filter((r): r is string => !!r).sort();
  const uniqueLocations = Array.from(new Set(tenants.map(t => t.preferredLocation))).filter((l): l is string => !!l).sort();

  const toggleFilter = (value: string, selected: string[], setSelected: (val: string[]) => void) => {
    if (selected.includes(value)) {
      setSelected(selected.filter(v => v !== value));
    } else {
      setSelected([...selected, value]);
    }
  };

  // Merge available inventory into property listings
  const inventoryAsLandlords: Landlord[] = inventory
    .filter(item => {
      const isManuallySet = manualAvailability[item.id] !== undefined;
      return isManuallySet 
        ? manualAvailability[item.id] 
        : item.availability?.toLowerCase().includes('available');
    })
    .map(item => ({
      id: item.id,
      timestamp: '',
      buildingType: '',
      forStatus: 'Rent',
      propertyType: '',
      areaDetails: item.propertyArea,
      furnishingStatus: item.statusFurnishing,
      propertyDescription: `Sector ${item.sector}, Plot ${item.plotId}`,
      floorNumber: item.floorLevel,
      ownerName: item.ownerName,
      contactNumber: item.phoneNumber,
      propertyAddress: `Sector ${item.sector}, Plot ${item.plotId}`,
      configuration: item.roomCount,
      rentPrice: item.rent,
      images: '',
      videos: '',
      email: '',
    }));

  const allProperties = [...landlords, ...inventoryAsLandlords];

  const getFilteredMatches = (matchList: MatchResult[]) => {
    return matchList.filter(match => {
      const scorePass = match.matchScore >= matchScoreFilter;
      const sourcePass = matchSourceFilter === 'All' || match.source === matchSourceFilter;
      return scorePass && sourcePass;
    });
  };

  return (
    <div className="flex h-screen bg-stone-50 font-sans text-stone-900">
      {/* Sidebar */}
      <div className="w-72 bg-stone-900 text-stone-100 flex flex-col shadow-xl z-10 shrink-0">
        <div className="p-6 border-b border-stone-800">
          <h1 className="text-2xl font-bold flex items-center gap-3 tracking-tight">
            <Building2 className="w-7 h-7 text-emerald-400" />
            Ivigil Estates
          </h1>
          <p className="text-stone-400 text-sm mt-2">AI-Powered CRM Dashboard</p>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setActiveTab('tenants')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
              activeTab === 'tenants' ? 'bg-emerald-500/10 text-emerald-400 font-medium' : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
            }`}
          >
            <Users className="w-5 h-5" />
            Tenant Applications
          </button>
          <button
            onClick={() => setActiveTab('landlords')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
              activeTab === 'landlords' ? 'bg-emerald-500/10 text-emerald-400 font-medium' : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
            }`}
          >
            <Home className="w-5 h-5" />
            Property Listings
          </button>
          <button
            onClick={() => setActiveTab('inventory')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
              activeTab === 'inventory' ? 'bg-emerald-500/10 text-emerald-400 font-medium' : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
            }`}
          >
            <Building2 className="w-5 h-5" />
            Complete Inventory
          </button>
          <button
            onClick={() => setActiveTab('matches')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
              activeTab === 'matches' ? 'bg-emerald-500/10 text-emerald-400 font-medium' : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
            }`}
          >
            <Sparkles className="w-5 h-5" />
            AI Matches
          </button>
          <button
            onClick={() => setActiveTab('map')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
              activeTab === 'map' ? 'bg-emerald-500/10 text-emerald-400 font-medium' : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
            }`}
          >
            <MapIcon className="w-5 h-5" />
            Map View
          </button>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-8 max-w-7xl mx-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-[80vh]">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mb-4"></div>
              <p className="text-stone-500">Loading Ivigil Estates CRM...</p>
            </div>
          ) : (
            <>
              {activeTab === 'tenants' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
                    <div>
                      <h2 className="text-3xl font-bold tracking-tight">New Tenant Applications</h2>
                      <p className="text-stone-500 mt-1">Review and match prospective tenants with available properties.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                      <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                        <input 
                          type="text" 
                          placeholder="Search tenants..." 
                          className="w-full pl-10 pr-4 py-2 bg-white border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                          value={tenantSearch}
                          onChange={(e) => setTenantSearch(e.target.value)}
                        />
                      </div>
                      <div className="flex items-center gap-2 bg-white border border-stone-200 rounded-xl px-3 py-2">
                        <ArrowUpDown className="w-4 h-4 text-stone-400" />
                        <select 
                          className="bg-transparent text-sm focus:outline-none cursor-pointer"
                          value={tenantSort}
                          onChange={(e) => setTenantSort(e.target.value as any)}
                        >
                          <option value="newest">Newest First</option>
                          <option value="budget-asc">Budget: Low to High</option>
                          <option value="budget-desc">Budget: High to Low</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Multi-select Filters */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-sm">
                      <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Filter className="w-3 h-3" /> Monthly Budget
                      </h4>
                      <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto custom-scrollbar pr-2">
                        {uniqueBudgets.map(budget => (
                          <button
                            key={budget}
                            onClick={() => toggleFilter(budget, selectedBudgets, setSelectedBudgets)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                              selectedBudgets.includes(budget)
                                ? 'bg-emerald-500 text-white shadow-sm'
                                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                            }`}
                          >
                            {budget}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-sm">
                      <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Filter className="w-3 h-3" /> Room Preference
                      </h4>
                      <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto custom-scrollbar pr-2">
                        {uniqueRooms.map(room => (
                          <button
                            key={room}
                            onClick={() => toggleFilter(room, selectedRooms, setSelectedRooms)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                              selectedRooms.includes(room)
                                ? 'bg-emerald-500 text-white shadow-sm'
                                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                            }`}
                          >
                            {room}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-sm">
                      <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Filter className="w-3 h-3" /> Preferred Location
                      </h4>
                      <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto custom-scrollbar pr-2">
                        {uniqueLocations.map(loc => (
                          <button
                            key={loc}
                            onClick={() => toggleFilter(loc, selectedLocations, setSelectedLocations)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                              selectedLocations.includes(loc)
                                ? 'bg-emerald-500 text-white shadow-sm'
                                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                            }`}
                          >
                            {loc}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {tenants
                      .filter(t => 
                        (t.fullName?.toLowerCase().includes(tenantSearch.toLowerCase()) || 
                        t.preferredLocation?.toLowerCase().includes(tenantSearch.toLowerCase()) ||
                        t.city?.toLowerCase().includes(tenantSearch.toLowerCase())) &&
                        (selectedBudgets.length === 0 || selectedBudgets.includes(t.monthlyBudget)) &&
                        (selectedRooms.length === 0 || selectedRooms.includes(t.roomPreference)) &&
                        (selectedLocations.length === 0 || selectedLocations.includes(t.preferredLocation))
                      )
                      .sort((a, b) => {
                        if (tenantSort === 'budget-asc') return parseInt(a.monthlyBudget.replace(/\D/g, '')) - parseInt(b.monthlyBudget.replace(/\D/g, ''));
                        if (tenantSort === 'budget-desc') return parseInt(b.monthlyBudget.replace(/\D/g, '')) - parseInt(a.monthlyBudget.replace(/\D/g, ''));
                        return 0; // Default newest (assuming they are in order from sheet)
                      })
                      .map(tenant => (
                      <div key={tenant.id} className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200 hover:shadow-md transition-all flex flex-col">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h3 className="text-lg font-semibold">{tenant.fullName || 'Anonymous'}</h3>
                            <p className="text-sm text-stone-500">{tenant.designation} • {tenant.city}</p>
                          </div>
                          <span className="bg-stone-100 text-stone-800 text-xs font-medium px-2.5 py-1 rounded-md">
                            {tenant.clientType}
                          </span>
                        </div>
                        <div className="space-y-3 mb-6 flex-1">
                          <div className="flex justify-between text-sm border-b border-stone-50 pb-2">
                            <span className="text-stone-500">Budget:</span>
                            <span className="font-medium text-emerald-600">₹{tenant.monthlyBudget}</span>
                          </div>
                          <div className="flex justify-between text-sm border-b border-stone-50 pb-2">
                            <span className="text-stone-500">Looking for:</span>
                            <span className="font-medium">{tenant.roomPreference}</span>
                          </div>
                          <div className="flex justify-between text-sm border-b border-stone-50 pb-2">
                            <span className="text-stone-500">Location:</span>
                            <span className="font-medium truncate max-w-[150px]" title={tenant.preferredLocation}>{tenant.preferredLocation}</span>
                          </div>
                          <div className="flex justify-between text-sm border-b border-stone-50 pb-2">
                            <span className="text-stone-500">Move-in Date:</span>
                            <span className="font-medium">{tenant.exactShiftingDate}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-stone-500">Contact:</span>
                            <span className="font-medium">{tenant.mobileNumber}</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleMatchTenant(tenant)}
                            className="flex-1 bg-stone-900 hover:bg-stone-800 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <Sparkles className="w-4 h-4 text-emerald-400" />
                            Matches
                          </button>
                          <a
                            href={`https://wa.me/${formatWhatsAppNumber(tenant.mobileNumber)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                            title="Contact on WhatsApp"
                          >
                            <MessageCircle className="w-5 h-5" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'landlords' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
                    <div>
                      <h2 className="text-3xl font-bold tracking-tight">New Property Listings</h2>
                      <p className="text-stone-500 mt-1">Manage available properties and find suitable tenants.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                      <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                        <input 
                          type="text" 
                          placeholder="Search properties..." 
                          className="w-full pl-10 pr-4 py-2 bg-white border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                          value={landlordSearch}
                          onChange={(e) => setLandlordSearch(e.target.value)}
                        />
                      </div>
                      <div className="flex items-center gap-2 bg-white border border-stone-200 rounded-xl px-3 py-2">
                        <ArrowUpDown className="w-4 h-4 text-stone-400" />
                        <select 
                          className="bg-transparent text-sm focus:outline-none cursor-pointer"
                          value={landlordSort}
                          onChange={(e) => setLandlordSort(e.target.value as any)}
                        >
                          <option value="newest">Newest First</option>
                          <option value="rent-asc">Rent: Low to High</option>
                          <option value="rent-desc">Rent: High to Low</option>
                        </select>
                      </div>
                      <div className="bg-white px-4 py-2 rounded-xl shadow-sm border border-stone-200 text-sm font-medium">
                        Total: {allProperties.length}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {allProperties
                      .filter(l => 
                        l.propertyAddress?.toLowerCase().includes(landlordSearch.toLowerCase()) || 
                        l.ownerName?.toLowerCase().includes(landlordSearch.toLowerCase()) ||
                        l.configuration?.toLowerCase().includes(landlordSearch.toLowerCase())
                      )
                      .sort((a, b) => {
                        const getPrice = (p: string) => parseInt(p.replace(/\D/g, '')) || 0;
                        if (landlordSort === 'rent-asc') return getPrice(a.rentPrice) - getPrice(b.rentPrice);
                        if (landlordSort === 'rent-desc') return getPrice(b.rentPrice) - getPrice(a.rentPrice);
                        return 0;
                      })
                      .map(landlord => {
                      const images = parseDriveLinks(landlord.images);
                      const videos = parseDriveLinks(landlord.videos);
                      return (
                        <div key={landlord.id} className="bg-white rounded-2xl shadow-sm border border-stone-200 hover:shadow-md transition-all flex flex-col overflow-hidden">
                          {/* Property Image Cover */}
                          {images.length > 0 ? (
                            <button 
                              onClick={() => setSelectedMedia({ url: images[0].imageUrl, type: 'image' })}
                              className="h-48 w-full bg-stone-100 relative group cursor-pointer block"
                            >
                              <img 
                                src={images[0].imageUrl} 
                                alt="Property" 
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/realestate/600/400';
                                }}
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                <ExternalLink className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                              </div>
                              {images.length > 1 && (
                                <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-sm text-white text-xs font-medium px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                                  <ImageIcon className="w-3 h-3" />
                                  +{images.length - 1}
                                </div>
                              )}
                            </button>
                          ) : (
                            <div className="h-48 w-full bg-stone-100 flex flex-col items-center justify-center text-stone-400">
                              <Home className="w-8 h-8 mb-2 opacity-50" />
                              <span className="text-xs font-medium uppercase tracking-wider">No Images</span>
                            </div>
                          )}

                          <div className="p-6 flex-1 flex flex-col">
                            <div className="flex justify-between items-start mb-4">
                              <div>
                                <h3 className="text-lg font-semibold">{landlord.configuration}</h3>
                                <p className="text-sm text-stone-500 truncate max-w-[200px]" title={landlord.propertyAddress}>{landlord.propertyAddress.split(',')[0]}</p>
                              </div>
                              <span className="bg-emerald-100 text-emerald-800 text-xs font-medium px-2.5 py-1 rounded-md shrink-0">
                                {landlord.forStatus}
                              </span>
                            </div>
                            <div className="space-y-3 mb-6 flex-1">
                              <div className="flex justify-between text-sm border-b border-stone-50 pb-2">
                                <span className="text-stone-500">Rent:</span>
                                <span className="font-medium text-emerald-600">₹{landlord.rentPrice}</span>
                              </div>
                              <div className="flex justify-between text-sm border-b border-stone-50 pb-2">
                                <span className="text-stone-500">Type:</span>
                                <span className="font-medium">{landlord.propertyType}</span>
                              </div>
                              <div className="flex justify-between text-sm border-b border-stone-50 pb-2">
                                <span className="text-stone-500">Furnishing:</span>
                                <span className="font-medium">{landlord.furnishingStatus}</span>
                              </div>
                              <div className="flex justify-between text-sm border-b border-stone-50 pb-2">
                                <span className="text-stone-500">Area:</span>
                                <span className="font-medium">{landlord.areaDetails}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-stone-500">Owner:</span>
                                <span className="font-medium">{landlord.ownerName}</span>
                              </div>
                            </div>
                            
                            {/* Media Gallery if available */}
                            {(images.length > 0 || videos.length > 0) && (
                              <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar mt-auto pt-4 border-t border-stone-100 mb-4">
                                {images.map((img, idx) => (
                                  <button 
                                    key={idx} 
                                    onClick={() => setSelectedMedia({ url: img.imageUrl, type: 'image' })}
                                    className="shrink-0 relative group/img block w-16 h-12 rounded-md overflow-hidden border border-stone-200 cursor-pointer"
                                  >
                                    <img 
                                      src={img.imageUrl} 
                                      alt={`Property ${idx + 1}`} 
                                      className="w-full h-full object-cover group-hover/img:scale-110 transition-transform duration-300"
                                      referrerPolicy="no-referrer"
                                    />
                                  </button>
                                ))}
                                {videos.map((vid, idx) => (
                                  <button 
                                    key={`vid-${idx}`} 
                                    onClick={() => setSelectedMedia({ url: vid.previewUrl, type: 'video' })}
                                    className="shrink-0 w-16 h-12 rounded-md overflow-hidden border border-stone-200 bg-stone-100 flex flex-col items-center justify-center text-stone-500 hover:bg-stone-200 hover:text-stone-700 transition-colors cursor-pointer"
                                  >
                                    <Video className="w-4 h-4" />
                                  </button>
                                ))}
                              </div>
                            )}

                            <button
                              onClick={() => handleMatchLandlord(landlord)}
                              className="w-full bg-stone-900 hover:bg-stone-800 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer mt-auto"
                            >
                              <Sparkles className="w-4 h-4 text-emerald-400" />
                              Find Tenants
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === 'inventory' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
                    <div>
                      <h2 className="text-3xl font-bold tracking-tight">Complete Inventory</h2>
                      <p className="text-stone-500 mt-1">Full list of properties with availability confirmed by landlords.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                      <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                        <input 
                          type="text" 
                          placeholder="Search inventory..." 
                          className="w-full pl-10 pr-4 py-2 bg-white border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                          value={inventorySearch}
                          onChange={(e) => setInventorySearch(e.target.value)}
                        />
                      </div>
                      <div className="flex items-center gap-2 bg-white border border-stone-200 rounded-xl px-3 py-2">
                        <ArrowUpDown className="w-4 h-4 text-stone-400" />
                        <select 
                          className="bg-transparent text-sm focus:outline-none cursor-pointer"
                          value={inventorySort}
                          onChange={(e) => setInventorySort(e.target.value as any)}
                        >
                          <option value="newest">Newest First</option>
                          <option value="rent-asc">Price: Low to High</option>
                          <option value="rent-desc">Price: High to Low</option>
                        </select>
                      </div>
                      <div className="bg-white px-4 py-2 rounded-xl shadow-sm border border-stone-200 text-sm font-medium">
                        Total: {inventory.length}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {inventory
                      .filter(item => 
                        item.sector?.toLowerCase().includes(inventorySearch.toLowerCase()) || 
                        item.plotId?.toLowerCase().includes(inventorySearch.toLowerCase()) ||
                        item.ownerName?.toLowerCase().includes(inventorySearch.toLowerCase()) ||
                        item.roomCount?.toLowerCase().includes(inventorySearch.toLowerCase())
                      )
                      .sort((a, b) => {
                        const getPrice = (p: string) => {
                          if (!p) return 0;
                          let val = p.toLowerCase();
                          if (val.includes('l')) return parseFloat(val) * 100000;
                          if (val.includes('cr')) return parseFloat(val) * 10000000;
                          if (val.includes('k')) return parseFloat(val) * 1000;
                          return parseInt(p.replace(/\D/g, '')) || 0;
                        };
                        if (inventorySort === 'rent-asc') return getPrice(a.rent) - getPrice(b.rent);
                        if (inventorySort === 'rent-desc') return getPrice(b.rent) - getPrice(a.rent);
                        return 0;
                      })
                      .map(item => {
                        // Find matching landlord by phone number to get images/videos
                        const matchingLandlord = landlords.find(l => {
                          const lPhone = formatWhatsAppNumber(l.contactNumber || '');
                          const iPhone = formatWhatsAppNumber(item.phoneNumber || '');
                          return lPhone && iPhone && lPhone === iPhone;
                        });
                        
                        const images = matchingLandlord ? parseDriveLinks(matchingLandlord.images) : [];
                        const videos = matchingLandlord ? parseDriveLinks(matchingLandlord.videos) : [];
                        
                        // Availability logic: check manual override first, then sheet data
                        const isManuallySet = manualAvailability[item.id] !== undefined;
                        const isAvailable = isManuallySet 
                          ? manualAvailability[item.id] 
                          : (item.availability?.toLowerCase().includes('available') || !!matchingLandlord);
                        
                        return (
                          <div key={item.id} className="bg-white rounded-2xl shadow-sm border border-stone-200 hover:shadow-md transition-all flex flex-col overflow-hidden">
                            {/* Property Image Cover */}
                            {images.length > 0 ? (
                              <button 
                                onClick={() => setSelectedMedia({ url: images[0].imageUrl, type: 'image' })}
                                className="h-48 w-full bg-stone-100 relative group cursor-pointer block"
                              >
                                <img 
                                  src={images[0].imageUrl} 
                                  alt="Property" 
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/realestate/600/400';
                                  }}
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                  <ExternalLink className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                                </div>
                                {images.length > 1 && (
                                  <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-sm text-white text-xs font-medium px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                                    <ImageIcon className="w-3 h-3" />
                                    +{images.length - 1}
                                  </div>
                                )}
                              </button>
                            ) : (
                              <div className="h-48 w-full bg-stone-100 flex flex-col items-center justify-center text-stone-400">
                                <Building2 className="w-8 h-8 mb-2 opacity-50" />
                                <span className="text-xs font-medium uppercase tracking-wider">No Images</span>
                              </div>
                            )}

                            <div className="p-6 flex-1 flex flex-col">
                              <div className="flex justify-between items-start mb-4">
                                <div>
                                  <h3 className="text-lg font-semibold">Sector {item.sector}, {item.plotId}</h3>
                                  <p className="text-sm text-stone-500">{item.roomCount}</p>
                                </div>
                                <button
                                  onClick={() => toggleAvailability(item.id)}
                                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                                    isAvailable 
                                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' 
                                      : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                                  }`}
                                >
                                  {isAvailable ? (
                                    <><CheckCircle2 className="w-3 h-3" /> Available</>
                                  ) : (
                                    <><XCircle className="w-3 h-3" /> Unavailable</>
                                  )}
                                </button>
                              </div>
                              
                              <div className="space-y-3 mb-6 flex-1">
                                <div className="flex justify-between text-sm border-b border-stone-50 pb-2">
                                  <span className="text-stone-500">Rent:</span>
                                  <span className="font-medium text-emerald-600">₹{item.rent || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between text-sm border-b border-stone-50 pb-2">
                                  <span className="text-stone-500">Floor:</span>
                                  <span className="font-medium">{item.floorLevel || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between text-sm border-b border-stone-50 pb-2">
                                  <span className="text-stone-500">Furnishing:</span>
                                  <span className="font-medium">{item.statusFurnishing || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between text-sm border-b border-stone-50 pb-2">
                                  <span className="text-stone-500">Area:</span>
                                  <span className="font-medium">{item.propertyArea || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                  <span className="text-stone-500">Owner:</span>
                                  <span className="font-medium">{item.ownerName}</span>
                                </div>
                              </div>
                              
                              {/* Media Gallery if available */}
                              {(images.length > 0 || videos.length > 0) && (
                                <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar mt-auto pt-4 border-t border-stone-100">
                                  {images.map((img, idx) => (
                                    <button 
                                      key={idx} 
                                      onClick={() => setSelectedMedia({ url: img.imageUrl, type: 'image' })}
                                      className="shrink-0 relative group/img block w-16 h-12 rounded-md overflow-hidden border border-stone-200 cursor-pointer"
                                    >
                                      <img 
                                        src={img.imageUrl} 
                                        alt={`Property ${idx + 1}`} 
                                        className="w-full h-full object-cover group-hover/img:scale-110 transition-transform duration-300"
                                        referrerPolicy="no-referrer"
                                      />
                                    </button>
                                  ))}
                                  {videos.map((vid, idx) => (
                                    <button 
                                      key={`vid-${idx}`} 
                                      onClick={() => setSelectedMedia({ url: vid.previewUrl, type: 'video' })}
                                      className="shrink-0 w-16 h-12 rounded-md overflow-hidden border border-stone-200 bg-stone-100 flex flex-col items-center justify-center text-stone-500 hover:bg-stone-200 hover:text-stone-700 transition-colors cursor-pointer"
                                    >
                                      <Video className="w-4 h-4" />
                                    </button>
                                  ))}
                                </div>
                              )}

                              <button
                                onClick={() => {
                                  const landlordObj: Landlord = {
                                    id: item.id,
                                    timestamp: '',
                                    buildingType: '',
                                    forStatus: 'Rent',
                                    propertyType: '',
                                    areaDetails: item.propertyArea,
                                    furnishingStatus: item.statusFurnishing,
                                    propertyDescription: `Sector ${item.sector}, Plot ${item.plotId}`,
                                    floorNumber: item.floorLevel,
                                    ownerName: item.ownerName,
                                    contactNumber: item.phoneNumber,
                                    propertyAddress: `Sector ${item.sector}, Plot ${item.plotId}`,
                                    configuration: item.roomCount,
                                    rentPrice: item.rent,
                                    images: matchingLandlord?.images || '',
                                    videos: matchingLandlord?.videos || '',
                                    email: '',
                                  };
                                  handleMatchLandlord(landlordObj);
                                }}
                                className="w-full bg-stone-900 hover:bg-stone-800 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer mt-4"
                              >
                                <Sparkles className="w-4 h-4 text-emerald-400" />
                                Find Tenants
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {activeTab === 'matches' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex justify-between items-center mb-8">
                    <h2 className="text-3xl font-bold tracking-tight">AI Match Analysis</h2>
                    {Object.keys(allMatches).length === 0 && !matching && (
                      <button
                        onClick={handleMatchAllTenants}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-medium flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
                      >
                        <Sparkles className="w-4 h-4" />
                        Match All Tenants ({tenants.length})
                      </button>
                    )}
                    {Object.keys(allMatches).length > 0 && !matching && (
                      <button
                        onClick={() => { setAllMatches({}); setSelectedTenant(null); setSelectedLandlord(null); }}
                        className="text-stone-500 hover:text-stone-800 text-sm font-medium flex items-center gap-2 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                        Clear All Matches
                      </button>
                    )}
                  </div>

                  {/* Match Filters */}
                  {(Object.keys(allMatches).length > 0 || selectedTenant || selectedLandlord) && !matching && (
                    <div className="flex flex-wrap gap-4 mb-8 items-center bg-white p-4 rounded-2xl border border-stone-200 shadow-sm">
                      <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-stone-400" />
                        <span className="text-sm font-bold text-stone-500 uppercase tracking-wider">Filters:</span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-stone-600">Min Score:</span>
                        <select 
                          value={matchScoreFilter}
                          onChange={(e) => setMatchScoreFilter(Number(e.target.value))}
                          className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        >
                          <option value={0}>All Scores</option>
                          <option value={50}>50+</option>
                          <option value={75}>75+</option>
                          <option value={90}>90+</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-sm text-stone-600">Source:</span>
                        <select 
                          value={matchSourceFilter}
                          onChange={(e) => setMatchSourceFilter(e.target.value as any)}
                          className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        >
                          <option value="All">All Sources</option>
                          <option value="Property Listing">Property Listing</option>
                          <option value="Complete Inventory">Complete Inventory</option>
                        </select>
                      </div>

                      {(matchScoreFilter > 0 || matchSourceFilter !== 'All') && (
                        <button 
                          onClick={() => { setMatchScoreFilter(0); setMatchSourceFilter('All'); }}
                          className="text-xs font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-wider ml-auto"
                        >
                          Reset Filters
                        </button>
                      )}
                    </div>
                  )}
                  
                  {!selectedTenant && !selectedLandlord && Object.keys(allMatches).length === 0 && !matching ? (
                    <div className="bg-white rounded-3xl p-16 text-center border border-stone-200 shadow-sm">
                      <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Sparkles className="w-10 h-10 text-emerald-500" />
                      </div>
                      <h3 className="text-xl font-semibold mb-3">AI Matching Engine</h3>
                      <p className="text-stone-500 max-w-md mx-auto mb-8">
                        Select a tenant from the Applications tab or click the button above to generate AI-powered matches for all 153 tenants.
                      </p>
                      <button
                        onClick={handleMatchAllTenants}
                        className="bg-stone-900 hover:bg-stone-800 text-white px-8 py-4 rounded-2xl font-bold flex items-center gap-3 mx-auto transition-all shadow-xl cursor-pointer"
                      >
                        <Sparkles className="w-5 h-5 text-emerald-400" />
                        Start Global Matching
                      </button>
                    </div>
                  ) : matching ? (
                    <div className="bg-white rounded-3xl p-16 text-center border border-stone-200 shadow-sm">
                      <div className="relative w-24 h-24 mx-auto mb-8">
                        <div className="absolute inset-0 animate-spin rounded-full border-b-4 border-emerald-500"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Sparkles className="w-8 h-8 text-emerald-500 animate-pulse" />
                        </div>
                      </div>
                      <h3 className="text-xl font-semibold mb-3">
                        {matchAllProgress ? `Matching Tenants (${matchAllProgress.current}/${matchAllProgress.total})` : 'Analyzing Compatibility...'}
                      </h3>
                      <p className="text-stone-500 mb-6">
                        {matchAllProgress 
                          ? `Processing batch of tenants using Gemini AI. This may take a few minutes.`
                          : (selectedTenant 
                              ? `Evaluating ${selectedTenant.fullName}'s requirements against ${landlords.length} available properties using AI.`
                              : `Evaluating property features against ${tenants.length} potential tenants using AI.`)}
                      </p>
                      {matchAllProgress && (
                        <div className="max-w-md mx-auto bg-stone-100 h-2.5 rounded-full overflow-hidden">
                          <div 
                            className="bg-emerald-500 h-full transition-all duration-500" 
                            style={{ width: `${(matchAllProgress.current / matchAllProgress.total) * 100}%` }}
                          ></div>
                        </div>
                      )}
                    </div>
                  ) : Object.keys(allMatches).length > 0 && !selectedTenant && !selectedLandlord ? (
                    <div className="space-y-12">
                      <div className="grid gap-8">
                        {tenants
                          .filter(t => getFilteredMatches(allMatches[t.id] || []).length > 0)
                          .map(tenant => {
                            const tenantMatches = getFilteredMatches(allMatches[tenant.id]);
                            return (
                              <div key={tenant.id} className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
                                <div className="p-6 bg-stone-900 text-white flex flex-col md:flex-row justify-between items-center gap-4">
                                  <div>
                                    <h3 className="text-xl font-bold">{tenant.fullName}</h3>
                                    <p className="text-stone-400 text-sm">{tenant.roomPreference} • ₹{tenant.monthlyBudget} • {tenant.preferredLocation}</p>
                                  </div>
                                  <div className="flex items-center gap-4">
                                    <div className="text-right">
                                      <div className="text-2xl font-bold text-emerald-400">{tenantMatches.length}</div>
                                      <div className="text-[10px] uppercase tracking-widest text-stone-500 font-bold">Matches Found</div>
                                    </div>
                                    <button 
                                      onClick={() => handleMatchTenant(tenant)}
                                      className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer"
                                    >
                                      View Details
                                    </button>
                                  </div>
                                </div>
                                <div className="p-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                  {tenantMatches.slice(0, 3).map((match, idx) => {
                                    const property = allProperties.find(p => p.id === match.landlordId);
                                    if (!property) return null;
                                    return (
                                      <div key={idx} className="bg-stone-50 rounded-2xl p-4 border border-stone-100 flex items-center gap-4">
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold shrink-0 ${
                                          match.matchScore >= 80 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                        }`}>
                                          {match.matchScore}
                                        </div>
                                        <div className="min-w-0">
                                          <h4 className="font-bold text-sm truncate">{property.configuration}</h4>
                                          <p className="text-xs text-stone-500 truncate">{property.propertyAddress}</p>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {tenantMatches.length > 3 && (
                                    <button 
                                      onClick={() => handleMatchTenant(tenant)}
                                      className="flex items-center justify-center gap-2 text-stone-400 hover:text-stone-600 text-sm font-medium transition-all cursor-pointer border-2 border-dashed border-stone-200 rounded-2xl h-full py-4"
                                    >
                                      +{tenantMatches.length - 3} more matches
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-8">
                      {/* Context Header */}
                      <div className="bg-white rounded-2xl p-8 border border-stone-200 shadow-sm flex flex-col md:flex-row gap-8 items-center justify-between">
                        <div className="flex-1 flex flex-col gap-4">
                          <div className="flex gap-6 items-center">
                            {selectedLandlord && parseDriveLinks(selectedLandlord.images).length > 0 && (
                              <button 
                                onClick={() => setSelectedMedia({ url: parseDriveLinks(selectedLandlord.images)[0].imageUrl, type: 'image' })}
                                className="w-24 h-24 rounded-xl overflow-hidden shrink-0 border border-stone-200 cursor-pointer relative group"
                              >
                                <img 
                                  src={parseDriveLinks(selectedLandlord.images)[0].imageUrl} 
                                  alt="Property" 
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                  <ExternalLink className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                                </div>
                              </button>
                            )}
                            <div>
                              <span className="text-sm font-bold tracking-wider text-emerald-600 uppercase mb-2 block">Target Profile</span>
                              {selectedTenant ? (
                                <>
                                  <h3 className="text-2xl font-bold mb-2">{selectedTenant.fullName}</h3>
                                  <div className="flex flex-wrap gap-4 text-sm">
                                    <span className="flex items-center gap-1.5 text-stone-600"><CheckCircle2 className="w-4 h-4 text-emerald-500"/> Budget: ₹{selectedTenant.monthlyBudget}</span>
                                    <span className="flex items-center gap-1.5 text-stone-600"><CheckCircle2 className="w-4 h-4 text-emerald-500"/> Needs: {selectedTenant.roomPreference}</span>
                                    <span className="flex items-center gap-1.5 text-stone-600"><CheckCircle2 className="w-4 h-4 text-emerald-500"/> Loc: {selectedTenant.preferredLocation}</span>
                                  </div>
                                </>
                              ) : selectedLandlord ? (
                                <>
                                  <h3 className="text-2xl font-bold mb-2">{selectedLandlord.configuration} in {selectedLandlord.propertyAddress.split(',')[0]}</h3>
                                  <div className="flex flex-wrap gap-4 text-sm">
                                    <span className="flex items-center gap-1.5 text-stone-600"><CheckCircle2 className="w-4 h-4 text-emerald-500"/> Rent: ₹{selectedLandlord.rentPrice}</span>
                                    <span className="flex items-center gap-1.5 text-stone-600"><CheckCircle2 className="w-4 h-4 text-emerald-500"/> Type: {selectedLandlord.propertyType}</span>
                                    <span className="flex items-center gap-1.5 text-stone-600"><CheckCircle2 className="w-4 h-4 text-emerald-500"/> Furnishing: {selectedLandlord.furnishingStatus}</span>
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </div>
                          
                          {/* Media Gallery for Selected Landlord */}
                          {selectedLandlord && (parseDriveLinks(selectedLandlord.images).length > 0 || parseDriveLinks(selectedLandlord.videos).length > 0) && (
                            <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar pt-2 border-t border-stone-100">
                              {parseDriveLinks(selectedLandlord.images).map((img, idx) => (
                                <button 
                                  key={idx} 
                                  onClick={() => setSelectedMedia({ url: img.imageUrl, type: 'image' })}
                                  className="shrink-0 relative group/img block w-16 h-12 rounded-md overflow-hidden border border-stone-200 cursor-pointer"
                                >
                                  <img 
                                    src={img.imageUrl} 
                                    alt={`Property ${idx + 1}`} 
                                    className="w-full h-full object-cover group-hover/img:scale-110 transition-transform duration-300"
                                    referrerPolicy="no-referrer"
                                  />
                                </button>
                              ))}
                              {parseDriveLinks(selectedLandlord.videos).map((vid, idx) => (
                                <button 
                                  key={`vid-${idx}`} 
                                  onClick={() => setSelectedMedia({ url: vid.previewUrl, type: 'video' })}
                                  className="shrink-0 w-16 h-12 rounded-md overflow-hidden border border-stone-200 bg-stone-100 flex flex-col items-center justify-center text-stone-500 hover:bg-stone-200 hover:text-stone-700 transition-colors cursor-pointer"
                                >
                                  <Video className="w-4 h-4" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="hidden md:flex items-center justify-center w-16 h-16 bg-stone-50 rounded-full shrink-0">
                          <ArrowRight className="w-6 h-6 text-stone-400" />
                        </div>
                        <div className="flex-1 text-right">
                          <span className="text-sm font-bold tracking-wider text-stone-400 uppercase mb-2 block">Results Found</span>
                          <div className="text-4xl font-light text-stone-900">{getFilteredMatches(matches).length} <span className="text-xl text-stone-500">Matches</span></div>
                        </div>
                      </div>
                      
                      {/* Match Results */}
                      <div className="grid gap-6">
                        {getFilteredMatches(matches).map((match, index) => {
                          if (selectedTenant) {
                            const property = allProperties.find(l => l.id === match.landlordId);
                            if (!property) return null;
                            
                            const images = parseDriveLinks(property.images);
                            const videos = parseDriveLinks(property.videos);
                            
                            return (
                              <div key={`${match.landlordId}-${index}`} className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200 flex flex-col md:flex-row gap-8 relative overflow-hidden group hover:border-emerald-200 transition-colors">
                                {/* Score Indicator */}
                                <div className={`absolute top-0 left-0 w-2 h-full ${
                                  match.matchScore >= 80 ? 'bg-emerald-500' :
                                  match.matchScore >= 50 ? 'bg-amber-400' :
                                  'bg-red-400'
                                }`}></div>
                                
                                <div className="flex-1 pl-4">
                                  <div className="flex justify-between items-start mb-4">
                                    <div>
                                      <div className="flex items-center gap-2 mb-1">
                                        <h3 className="text-xl font-bold">{property.configuration}</h3>
                                        <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold ${
                                          match.source === 'Complete Inventory' 
                                            ? 'bg-purple-100 text-purple-700' 
                                            : 'bg-blue-100 text-blue-700'
                                        }`}>
                                          {match.source || 'Property Listing'}
                                        </span>
                                      </div>
                                      <p className="text-stone-500">{property.propertyAddress}</p>
                                    </div>
                                    <div className="text-center">
                                      <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl font-bold text-xl ${
                                        match.matchScore >= 80 ? 'bg-emerald-50 text-emerald-600' :
                                        match.matchScore >= 50 ? 'bg-amber-50 text-amber-600' :
                                        'bg-red-50 text-red-600'
                                      }`}>
                                        {match.matchScore}
                                      </div>
                                      <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mt-1">Match</div>
                                    </div>
                                  </div>

                                  {/* Property Media Gallery */}
                                  {(images.length > 0 || videos.length > 0) && (
                                    <div className="mb-6">
                                      <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
                                        {images.map((img, idx) => (
                                          <button 
                                            key={idx} 
                                            onClick={() => setSelectedMedia({ url: img.imageUrl, type: 'image' })}
                                            className="shrink-0 relative group/img block w-32 h-24 rounded-lg overflow-hidden border border-stone-200 cursor-pointer"
                                          >
                                            <img 
                                              src={img.imageUrl} 
                                              alt={`Property ${idx + 1}`} 
                                              className="w-full h-full object-cover group-hover/img:scale-110 transition-transform duration-300"
                                              referrerPolicy="no-referrer"
                                            />
                                            <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
                                              <ExternalLink className="w-5 h-5 text-white opacity-0 group-hover/img:opacity-100 transition-opacity" />
                                            </div>
                                          </button>
                                        ))}
                                        {videos.map((vid, idx) => (
                                          <button 
                                            key={`vid-${idx}`} 
                                            onClick={() => setSelectedMedia({ url: vid.previewUrl, type: 'video' })}
                                            className="shrink-0 w-32 h-24 rounded-lg overflow-hidden border border-stone-200 bg-stone-100 flex flex-col items-center justify-center text-stone-500 hover:bg-stone-200 hover:text-stone-700 transition-colors cursor-pointer"
                                          >
                                            <Video className="w-6 h-6 mb-1" />
                                            <span className="text-xs font-medium">Watch Video</span>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  
                                  <div className="flex flex-wrap gap-3 mb-6">
                                    <span className="bg-stone-100 text-stone-700 px-3 py-1.5 rounded-lg text-sm font-medium">₹{property.rentPrice}</span>
                                    <span className="bg-stone-100 text-stone-700 px-3 py-1.5 rounded-lg text-sm font-medium">{property.furnishingStatus}</span>
                                    <span className="bg-stone-100 text-stone-700 px-3 py-1.5 rounded-lg text-sm font-medium">Floor: {property.floorNumber}</span>
                                  </div>
                                  
                                  <div className="bg-stone-50 rounded-xl p-5 border border-stone-100 mb-6 relative">
                                    <Sparkles className="w-5 h-5 text-emerald-400 absolute top-5 left-5" />
                                    <p className="text-sm text-stone-700 pl-8 leading-relaxed mb-4">
                                      {match.reasoning}
                                    </p>
                                    
                                    {(match.alignments?.length > 0 || match.contradictions?.length > 0) && (
                                      <div className="pl-8 grid gap-4 md:grid-cols-2 mt-4 border-t border-stone-200 pt-4">
                                        {match.alignments && match.alignments.length > 0 && (
                                          <div>
                                            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-600 mb-2">Alignments</h4>
                                            <ul className="space-y-1.5">
                                              {match.alignments.map((alignment, idx) => (
                                                <li key={idx} className="flex items-start gap-2 text-sm text-stone-600">
                                                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                                  <span>{alignment}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                        {match.contradictions && match.contradictions.length > 0 && (
                                          <div>
                                            <h4 className="text-xs font-bold uppercase tracking-wider text-red-500 mb-2">Contradictions</h4>
                                            <ul className="space-y-1.5">
                                              {match.contradictions.map((contradiction, idx) => (
                                                <li key={idx} className="flex items-start gap-2 text-sm text-stone-600">
                                                  <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                                                  <span>{contradiction}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  
                                  <div className="flex gap-4">
                                    <a 
                                      href={`https://wa.me/${formatWhatsAppNumber(property.contactNumber)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl text-sm font-medium transition-colors"
                                    >
                                      Contact Owner
                                    </a>
                                  </div>
                                </div>
                              </div>
                            );
                          } else if (selectedLandlord) {
                            const tenant = tenants.find(t => t.id === match.tenantId);
                            if (!tenant) return null;
                            
                            return (
                              <div key={`${match.tenantId}-${index}`} className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200 flex flex-col md:flex-row gap-8 relative overflow-hidden group hover:border-emerald-200 transition-colors">
                                {/* Score Indicator */}
                                <div className={`absolute top-0 left-0 w-2 h-full ${
                                  match.matchScore >= 80 ? 'bg-emerald-500' :
                                  match.matchScore >= 50 ? 'bg-amber-400' :
                                  'bg-red-400'
                                }`}></div>
                                
                                <div className="flex-1 pl-4">
                                  <div className="flex justify-between items-start mb-4">
                                    <div>
                                      <h3 className="text-xl font-bold">{tenant.fullName || 'Anonymous Applicant'}</h3>
                                      <p className="text-stone-500">{tenant.designation} • {tenant.clientType}</p>
                                    </div>
                                    <div className="text-center">
                                      <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl font-bold text-xl ${
                                        match.matchScore >= 80 ? 'bg-emerald-50 text-emerald-600' :
                                        match.matchScore >= 50 ? 'bg-amber-50 text-amber-600' :
                                        'bg-red-50 text-red-600'
                                      }`}>
                                        {match.matchScore}
                                      </div>
                                      <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mt-1">Match</div>
                                    </div>
                                  </div>
                                  
                                  <div className="flex flex-wrap gap-3 mb-6">
                                    <span className="bg-stone-100 text-stone-700 px-3 py-1.5 rounded-lg text-sm font-medium">Budget: ₹{tenant.monthlyBudget}</span>
                                    <span className="bg-stone-100 text-stone-700 px-3 py-1.5 rounded-lg text-sm font-medium">Needs: {tenant.roomPreference}</span>
                                    <span className="bg-stone-100 text-stone-700 px-3 py-1.5 rounded-lg text-sm font-medium">Move-in: {tenant.exactShiftingDate}</span>
                                  </div>
                                  
                                  <div className="bg-stone-50 rounded-xl p-5 border border-stone-100 mb-6 relative">
                                    <Sparkles className="w-5 h-5 text-emerald-400 absolute top-5 left-5" />
                                    <p className="text-sm text-stone-700 pl-8 leading-relaxed mb-4">
                                      {match.reasoning}
                                    </p>
                                    
                                    {(match.alignments?.length > 0 || match.contradictions?.length > 0) && (
                                      <div className="pl-8 grid gap-4 md:grid-cols-2 mt-4 border-t border-stone-200 pt-4">
                                        {match.alignments && match.alignments.length > 0 && (
                                          <div>
                                            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-600 mb-2">Alignments</h4>
                                            <ul className="space-y-1.5">
                                              {match.alignments.map((alignment, idx) => (
                                                <li key={idx} className="flex items-start gap-2 text-sm text-stone-600">
                                                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                                  <span>{alignment}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                        {match.contradictions && match.contradictions.length > 0 && (
                                          <div>
                                            <h4 className="text-xs font-bold uppercase tracking-wider text-red-500 mb-2">Contradictions</h4>
                                            <ul className="space-y-1.5">
                                              {match.contradictions.map((contradiction, idx) => (
                                                <li key={idx} className="flex items-start gap-2 text-sm text-stone-600">
                                                  <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                                                  <span>{contradiction}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  
                                  <div className="flex gap-4">
                                    <a 
                                      href={`https://wa.me/${formatWhatsAppNumber(tenant.mobileNumber)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl text-sm font-medium transition-colors"
                                    >
                                      Contact Tenant
                                    </a>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'map' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-[calc(100vh-160px)]">
                  <div className="flex justify-between items-center mb-6">
                    <div>
                      <h2 className="text-3xl font-bold tracking-tight">Geospatial Visualization</h2>
                      <p className="text-stone-500 mt-1">Visualizing property locations and tenant preferences across the city.</p>
                    </div>
                    <div className="flex gap-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                        <span className="text-xs font-medium text-stone-600">Properties</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                        <span className="text-xs font-medium text-stone-600">Tenant Preferences</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden h-full relative z-0">
                    <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''}>
                      <Map
                        defaultCenter={{lat: 28.4595, lng: 77.0266}}
                        defaultZoom={12}
                        mapId="DEMO_MAP_ID"
                        style={{ height: '100%', width: '100%' }}
                        disableDefaultUI={true}
                        zoomControl={true}
                      >
                        {/* Property Markers */}
                        {allProperties.map((prop, idx) => {
                          const seed = prop.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
                          const lat = 28.4595 + (Math.sin(seed) * 0.05);
                          const lng = 77.0266 + (Math.cos(seed) * 0.05);
                          const id = `prop-${prop.id}-${idx}`;

                          return (
                            <React.Fragment key={id}>
                              <AdvancedMarker
                                position={{lat, lng}}
                                onClick={() => setOpenInfoWindowId(id)}
                              >
                                <div className="w-3 h-3 bg-emerald-500 rounded-full border-2 border-white shadow-lg"></div>
                              </AdvancedMarker>
                              {openInfoWindowId === id && (
                                <InfoWindow
                                  position={{lat, lng}}
                                  onCloseClick={() => setOpenInfoWindowId(null)}
                                >
                                  <div className="p-1 min-w-[150px]">
                                    <h4 className="font-bold text-stone-900 text-sm">{prop.configuration}</h4>
                                    <p className="text-[10px] text-stone-500 mb-2">{prop.propertyAddress}</p>
                                    <div className="flex justify-between items-center">
                                      <span className="text-emerald-600 font-bold text-xs">₹{prop.rentPrice}</span>
                                      <button 
                                        onClick={() => handleMatchLandlord(prop)}
                                        className="text-[9px] bg-stone-900 text-white px-2 py-1 rounded hover:bg-stone-800 transition-colors"
                                      >
                                        Match
                                      </button>
                                    </div>
                                  </div>
                                </InfoWindow>
                              )}
                            </React.Fragment>
                          );
                        })}

                        {/* Tenant Markers */}
                        {tenants
                          .filter(t => t.city?.toLowerCase() === 'gurgaon')
                          .map((tenant, idx) => {
                          const seed = tenant.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) + 100;
                          const lat = 28.4595 + (Math.sin(seed) * 0.06);
                          const lng = 77.0266 + (Math.cos(seed) * 0.06);
                          const id = `tenant-${tenant.id}-${idx}`;

                          return (
                            <React.Fragment key={id}>
                              <AdvancedMarker
                                position={{lat, lng}}
                                onClick={() => setOpenInfoWindowId(id)}
                              >
                                <div className="w-3 h-3 bg-blue-500 rounded-full border-2 border-white shadow-lg"></div>
                              </AdvancedMarker>
                              {openInfoWindowId === id && (
                                <InfoWindow
                                  position={{lat, lng}}
                                  onCloseClick={() => setOpenInfoWindowId(null)}
                                >
                                  <div className="p-1 min-w-[150px]">
                                    <h4 className="font-bold text-stone-900 text-sm">{tenant.fullName}</h4>
                                    <p className="text-[10px] text-stone-500 mb-1">Prefers: {tenant.preferredLocation}</p>
                                    <p className="text-[10px] text-stone-500 mb-2">Budget: ₹{tenant.monthlyBudget}</p>
                                    <button 
                                      onClick={() => handleMatchTenant(tenant)}
                                      className="text-[9px] bg-stone-900 text-white px-2 py-1 rounded hover:bg-stone-800 transition-colors w-full"
                                    >
                                      Find Matches
                                    </button>
                                  </div>
                                </InfoWindow>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </Map>
                    </APIProvider>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Media Modal */}
      {selectedMedia && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedMedia(null)}>
          <div className="relative w-full max-w-5xl max-h-[90vh] flex flex-col items-center justify-center" onClick={e => e.stopPropagation()}>
            <button 
              onClick={() => setSelectedMedia(null)}
              className="absolute -top-12 right-0 p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors"
            >
              <X className="w-8 h-8" />
            </button>
            
            {selectedMedia.type === 'image' ? (
              <img 
                src={selectedMedia.url} 
                alt="Property View" 
                className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
                referrerPolicy="no-referrer"
              />
            ) : (
              <iframe 
                src={selectedMedia.url} 
                className="w-full aspect-video rounded-lg shadow-2xl bg-black"
                allow="autoplay"
                allowFullScreen
              ></iframe>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
