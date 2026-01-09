import { Post, UserProfile, FacebookPage } from '../types';

export const fetchFacebookProfile = async (accessToken: string): Promise<UserProfile> => {
  const response = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name,picture.type(large)&access_token=${accessToken}`);
  if (!response.ok) {
    throw new Error('Failed to fetch profile');
  }
  const data = await response.json();
  return {
    name: data.name,
    handle: '@' + data.name.replace(/\s+/g, '').toLowerCase(),
    avatar: data.picture?.data?.url || 'https://via.placeholder.com/100'
  };
};

export const fetchManagedPages = async (userAccessToken: string): Promise<FacebookPage[]> => {
  // Fetch pages the user manages and get their specific Page Access Tokens
  // Requires 'pages_show_list' permission
  const response = await fetch(
    `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,picture&access_token=${userAccessToken}`
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Failed to fetch managed pages');
  }

  const data = await response.json();
  return data.data || [];
};

export const fetchFacebookPosts = async (accessToken: string, endpoint: string = 'me/feed'): Promise<Post[]> => {
  // Fetch feed (either user feed 'me/feed' or page feed '{pageId}/feed')
  const response = await fetch(
    `https://graph.facebook.com/v19.0/${endpoint}?fields=id,message,created_time,full_picture,likes.summary(true),from&limit=50&access_token=${accessToken}`
  );
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Failed to fetch posts');
  }

  const data = await response.json();
  
  // Map Graph API response to our Post type
  return data.data
    .filter((item: any) => item.message) // Only keep posts that have text content
    .map((item: any) => ({
      id: item.id,
      content: item.message,
      date: new Date(item.created_time).toISOString().split('T')[0],
      likes: item.likes?.summary?.total_count || 0,
      imageUrl: item.full_picture,
      originalAuthor: item.from?.name || 'Unknown'
    }));
};