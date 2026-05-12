export default function registerCreativeActions(registerLensAction) {
  registerLensAction("creative", "shotListGenerate", (_ctx, artifact, _params) => {
    const type = artifact.data?.type || 'photo';
    const shots = [];
    const defaultShots = type === 'video'
      ? ['Wide establishing shot', 'Medium two-shot', 'Close-up detail', 'Over-the-shoulder', 'B-roll cutaway', 'Tracking shot']
      : ['Hero shot', 'Detail close-up', 'Environmental wide', 'Portrait', 'Action shot', 'Flat lay'];
    defaultShots.forEach((desc, i) => {
      shots.push({ number: i + 1, description: desc, setup: 'TBD', lens: 'TBD', notes: '', status: 'planned' });
    });
    artifact.data = { ...artifact.data, shotList: shots };
    artifact.updatedAt = new Date().toISOString();
    return { ok: true, result: { shots, count: shots.length } };
  });

  registerLensAction("creative", "assetOrganize", (_ctx, artifact, _params) => {
    const assets = artifact.data?.assets || [];
    const organized = {};
    for (const asset of assets) {
      const cat = asset.type || 'uncategorized';
      if (!organized[cat]) organized[cat] = [];
      organized[cat].push(asset);
    }
    const summary = Object.entries(organized).map(([type, items]) => ({ type, count: items.length }));
    return { ok: true, result: { categories: summary, totalAssets: assets.length } };
  });

  registerLensAction("creative", "budgetTrack", (_ctx, artifact, _params) => {
    const budget = artifact.data?.budget || 0;
    const expenses = artifact.data?.expenses || [];
    const totalSpent = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const remaining = budget - totalSpent;
    const percentUsed = budget > 0 ? Math.round((totalSpent / budget) * 100) : 0;
    const byCategory = {};
    expenses.forEach(e => {
      const cat = e.category || 'Other';
      byCategory[cat] = (byCategory[cat] || 0) + (e.amount || 0);
    });
    return { ok: true, result: { budget, totalSpent, remaining, percentUsed, byCategory, overBudget: remaining < 0 } };
  });

  registerLensAction("creative", "distributionChecklist", (ctx, artifact, params) => {
    const type = artifact.data?.type || params.type || 'general';
    let checklist;
    if (type === 'podcast') {
      checklist = [
        { platform: 'Apple Podcasts', status: 'pending' }, { platform: 'Spotify', status: 'pending' },
        { platform: 'Google Podcasts', status: 'pending' }, { platform: 'Amazon Music', status: 'pending' },
        { platform: 'RSS Feed', status: 'pending' }, { platform: 'Show Notes Published', status: 'pending' },
        { platform: 'Social Media Promo', status: 'pending' },
      ];
    } else if (type === 'fashion') {
      checklist = [
        { platform: 'Lookbook Published', status: 'pending' }, { platform: 'Buyer Outreach', status: 'pending' },
        { platform: 'Press Release', status: 'pending' }, { platform: 'Social Media', status: 'pending' },
        { platform: 'E-commerce Upload', status: 'pending' },
      ];
    } else {
      checklist = [
        { platform: 'Client Delivery', status: 'pending' }, { platform: 'Portfolio Update', status: 'pending' },
        { platform: 'Social Media', status: 'pending' }, { platform: 'Website Gallery', status: 'pending' },
      ];
    }
    return { ok: true, result: { checklist, type, total: checklist.length } };
  });
};
