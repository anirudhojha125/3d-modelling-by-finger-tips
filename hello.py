#linear search
#arr=[10,20,30,40,50]
#e=input("enter element to search :")
#count=1
#for i in arr:
 #   if i==int(e):
  #      print("element is found at position : " ,count )
   # else:
    #    pass
    #count+=1
#binary search
"""def func(arr,search):
    left=0
    right=len(arr)-1
    for i in arr:
        mid=int((left+right)/2)
        if(arr[mid]==search):
            print("the element is on index",mid)
            break
        elif(arr[mid])>search:
            right=mid-1
        else:
            left=mid+1
    if arr[mid] != search:
        print("element is not found")
a=[1,5,3,7,8,10,2]
a.sort()
print(len(a))
print(a)
s=int(input("enter number to search "))
func(a,s)
"""
def func(arr):
    left=0
    right=len(arr)-1
    mid=int((left+right)/2)
    