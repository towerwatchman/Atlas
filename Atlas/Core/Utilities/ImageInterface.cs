﻿using System;
using System.Collections.Generic;
using System.Drawing.Imaging;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Media.Imaging;
using SixLabors.ImageSharp;
using System.Collections;
using System.Windows.Media;
using NLog;
using SixLabors.ImageSharp.Formats.Webp;
using Image = SixLabors.ImageSharp.Image;
using System.Windows.Shapes;
using SixLabors.ImageSharp.Processing;

namespace Atlas.Core.Utilities
{
    public class ImageInterface
    {
        public static Dictionary<int, BitmapImage> _cache = new Dictionary<int, BitmapImage>();

        public static readonly Logger Logger = LogManager.GetCurrentClassLogger();

        public BitmapImage LoadImages(string path, double width, double height = 0)
        {
            var image = new BitmapImage(new Uri("pack://application:,,,/Assets/Images/default.jpg"));

            //Check if path is empty or if the file exist
            if (path == "" || !File.Exists(path))
            {
                return image;
            }
            else
            {
                try
                {

                    var uri = new Uri(path);
                    BitmapImage bitmapImage = new BitmapImage();
                    bitmapImage.BeginInit();
                    bitmapImage.UriSource = uri;
                    bitmapImage.DecodePixelWidth = (int)width;
                    bitmapImage.CacheOption = BitmapCacheOption.Default;
                    bitmapImage.CreateOptions = BitmapCreateOptions.None;
                    bitmapImage.EndInit();
                    bitmapImage.Freeze();
                    return bitmapImage;//bi;

                }
                catch (Exception ex)
                {
                    Logger.Error(ex.Message);
                    return image;
                }
            }
        }

        public async Task<string> ConvertToWebpAsync(byte[] imageArray, string imagePath)
        {
            string path = "";
            try
            {
                using var inStream = new MemoryStream(imageArray);

                using (Image image = await Image.LoadAsync(inStream))
                {

                    int width = 1080;

                    image.Mutate(x => x.Resize(width, (width / image.Width) * image.Height, KnownResamplers.Lanczos3));

                    using var outStream = new MemoryStream();

                    await image.SaveAsync(outStream, new WebpEncoder());


                    await image.SaveAsWebpAsync($"{imagePath}.webp");
                    path = $"{imagePath}.webp";
                }
            }
            catch (Exception ex) { Logger.Error(ex); }

            return path;
        }

        public async Task<string> CreateThumb(byte[] imageArray, string imagePath)
        {
            string path = "";
            try
            {
                using var inStream = new MemoryStream(imageArray);

                using var image = await Image.LoadAsync(inStream);

                using var outStream = new MemoryStream();

                await image.SaveAsync(outStream, new WebpEncoder());

                await image.SaveAsWebpAsync($"{imagePath}.webp");
                image.Dispose();
                path = $"{imagePath}.webp";
            }
            catch (Exception ex) { Logger.Error(ex); }

            return path;
        }

        public static BitmapSource LoadImage(int id, string bannerPath, double imageRenderWidth, double imageRenderHeight = 0)
        {
            //Logger.Warn($"Getting image for id: {id}");
            //try to get image from cache

            //BitmapImage bitmapImage;
            //Uri uri = new Uri("pack://application:,,,/Assets/Images/default.jpg");
            string path = "";// "pack://application:,,,/Assets/Images/default.jpg";
            

            try
            {
                
                if (File.Exists(bannerPath))
                {
                    path = bannerPath;
                }
                else
                {
                    return null;
                }

                
                BitmapImage bitmapImage;
                if (!_cache.TryGetValue(id, out bitmapImage))
                {
                    Logger.Debug($"Loading Image from disk for: {id}");

                    byte[] image =  System.IO.File.ReadAllBytes(path);

                    bitmapImage = new BitmapImage();
                    bitmapImage.BeginInit();
                    //bitmapImage.UriSource = uri;
                    bitmapImage.StreamSource = new MemoryStream(image);
                    bitmapImage.DecodePixelWidth = (int)imageRenderWidth;
                    bitmapImage.CacheOption = BitmapCacheOption.Default;
                    bitmapImage.CreateOptions = BitmapCreateOptions.None;
                    bitmapImage.EndInit();
                    bitmapImage.Freeze();
                    //Logger.Warn(id);
                    try
                    {
                        //_cache.Add(id, bitmapImage);
                        
                    }
                    catch (Exception ex) { Logger.Error(ex); }


                    return bitmapImage;
                }
                else
                {
                    Logger.Info("Loading from cache");
                    return bitmapImage;
                }

            }
            catch (Exception ex)
            {
                Logger.Error(ex.Message);
                return null;
            }
        }
    }
}
